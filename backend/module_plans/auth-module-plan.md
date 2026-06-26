# Auth Module — Implementation Plan

> **Process:** This plan is split into phases. You review it, then tell me which phase (or phases) to implement.
> Within a phase, coding sequence is **repository → service → controller → route/module wiring**.
> **Testing:** You provide the unit tests (`*.spec.ts`); I implement the code to satisfy them. Each task lists the behaviors your tests should cover so we agree on the contract first.

**Goal:** Authentication for the Movie Reservation System — manual register/login with JWT, OTP email verification, and Google OAuth — with refresh tokens in httpOnly cookies and short-lived auth state in Redis.

**Architecture:** NestJS + Passport. Access + refresh JWTs delivered as httpOnly cookies. Email verification via OTP codes stored in Redis (TTL). Refresh tokens stored in Redis keyed by `userId:jti`. Google sign-in *blocks* when the email already exists as a manual account (user must log in and link from settings). Mailtrap (via nodemailer) sends OTP emails in dev.

**Tech Stack:** NestJS 11 · Passport (`passport-local`, `passport-jwt`, `passport-google-oauth20`) · `@nestjs/jwt` · `bcrypt` · `ioredis` · `nodemailer` · `cookie-parser` · Prisma 7 (pg adapter).

---

## Design Decisions (locked)

| Decision | Choice |
|---|---|
| Token delivery | httpOnly + Secure cookies |
| Token strategy | Access + refresh pair, refresh rotated on use |
| Email verification | OTP code (6 digits) via email |
| After OTP verify | **Auto-login** (issue cookies immediately) |
| Google + existing manual email | **Block** with 409 → "log in with password and link Google in settings" |
| Logout | Clear cookies only (no server-side revoke for now) |
| Short-lived store | Redis (OTP + refresh tokens), introduced in this module |

---

## Endpoints (all under global prefix `api/v1`)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Create user (`emailVerified=false`), send OTP |
| POST | `/auth/verify-otp` | public | Verify OTP → mark verified → **auto-login** (set cookies) |
| POST | `/auth/resend-otp` | public | Re-issue OTP (rate-limited by Redis) |
| POST | `/auth/login` | public | Manual login (blocked if not verified) → set cookies |
| POST | `/auth/refresh` | refresh cookie | Rotate tokens → set new cookies |
| POST | `/auth/logout` | access cookie | Clear cookies |
| GET | `/auth/me` | access cookie | Return current user |
| GET | `/auth/google` | public | Start Google OAuth redirect |
| GET | `/auth/google/callback` | public | Google callback → login / create / **block** |
| POST | `/auth/link-google` | access cookie | *(Phase 4)* Link Google to logged-in account |

---

## File Structure (final state)

```
src/auth/
├── auth.module.ts                 # wires everything
├── auth.controller.ts             # routes only, no business logic
├── auth.service.ts                # orchestration
├── auth.repository.ts             # all Prisma user queries
├── dto/
│   ├── register.dto.ts
│   ├── login.dto.ts
│   ├── verify-otp.dto.ts
│   └── resend-otp.dto.ts
├── strategies/
│   ├── jwt.strategy.ts            # access token, extracts from cookie
│   ├── jwt-refresh.strategy.ts    # refresh token, extracts from cookie
│   ├── local.strategy.ts          # email + password
│   └── google.strategy.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── jwt-refresh.guard.ts
│   ├── local-auth.guard.ts
│   └── google-auth.guard.ts
├── decorators/
│   └── current-user.decorator.ts  # @CurrentUser() param decorator
├── token.service.ts               # sign access/refresh, set/clear cookies
└── otp.service.ts                  # generate/store/verify OTP via Redis

src/redis/
├── redis.module.ts                # global, provides cache + pubsub clients
└── redis.constants.ts             # injection tokens

src/mailer/
├── mailer.module.ts
└── mailer.service.ts              # sendOtpEmail()
```

---

## PHASE 0 — Foundations (schema, infra, config)

**Outcome:** App boots with Postgres + Redis reachable, schema migrated, Redis & Mailer modules injectable, cookies parsed. No auth logic yet.

### Task 0.1 — Environment config (infra already provisioned)

**Files:** `backend/.env`

> **Infra is already set up** — Redis is configured in `docker-compose.yml` and PostgreSQL is already running locally. No docker-compose or Postgres changes needed in this plan. This task only adds the new auth-related env vars.

Before starting, confirm both are reachable:
- [ ] Redis: `npm run docker:up:dev` then `docker ps` shows the redis container(s) up on `6379` (and pubsub on `6380`).
- [ ] Postgres: `npm run prisma:studio` (or a `psql` connect) succeeds against `DATABASE_URL`.

**`.env` additions:**
```dotenv
# Frontend (already referenced in main.ts CORS)
FRONTEND_URL=http://localhost:5173

# JWT — split into access + refresh
JWT_ACCESS_SECRET=change_me_access
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=change_me_refresh
JWT_REFRESH_EXPIRES_IN=7d
COOKIE_DOMAIN=localhost

# OTP
OTP_TTL_SECONDS=600
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SECONDS=60

# Mailtrap (dev)
MAIL_HOST=live.smtp.mailtrap.io
MAIL_PORT=2525
MAIL_USER=smtp@mailtrap.io
MAIL_PASS=b2c2e3e8cc511aa287735e0a89bf4899
MAIL_FROM="Movie Reservation <no-reply@movieres.dev>"

# Google OAuth
GOOGLE_CLIENT_ID=98378765513-5b0732u8te3buo11merph64hdjc5rj2c.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
GOOGLE_CALLBACK_URL=https://localhost:3000/api/v1/auth/google/callback
```
> Keep the old `JWT_SECRET`/`JWT_EXPIRES_IN` only if other code references them; otherwise remove.

- [ ] Update `.env` with the vars above
- [ ] Commit: `chore(config): add jwt/otp/mail/google env vars`

### Task 0.2 — Install missing dependencies

```bash
npm i passport-local passport-google-oauth20 nodemailer cookie-parser
npm i -D @types/passport-local @types/passport-google-oauth20 @types/nodemailer @types/cookie-parser
```
- [ ] Install, commit lockfile: `chore(deps): add passport-local, google oauth, nodemailer, cookie-parser`

### Task 0.3 — Prisma schema *(PREREQUISITE — owned by you, not implemented in this plan)*

> The base schema is already designed and migrated. **You will add the 3 auth-specific fields below yourself** before we implement Phase 1. This task is documentation of the required contract, not work I'll do. Phases 1–3 assume these exist.

**Required `User` fields (additive to your existing model):**
```prisma
password      String?              // CHANGE: make nullable — Google-only users have no password
emailVerified Boolean  @default(false)   // ADD — OTP gate depends on it
googleId      String?  @unique           // ADD — Google account lookup/link
```

**Also required** (Prisma CLI migrate/generate needs it even with the pg adapter): add `url = env("DATABASE_URL")` to the `datasource db` block:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Definition of done (your side):** these fields exist in `schema.prisma`, a migration is applied, and `npm run prisma:generate` has run so the Prisma client types include them. Ping me once done and I'll proceed from Task 0.4.

### Task 0.4 — Redis module (global)

**Files:** `src/redis/redis.constants.ts`, `src/redis/redis.module.ts`

```ts
// redis.constants.ts
export const REDIS_CACHE = 'REDIS_CACHE';
export const REDIS_PUBSUB = 'REDIS_PUBSUB';
```
```ts
// redis.module.ts
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CACHE, REDIS_PUBSUB } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_CACHE_HOST,
          port: Number(process.env.REDIS_CACHE_PORT),
        }),
    },
    {
      provide: REDIS_PUBSUB,
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_PUBSUB_HOST,
          port: Number(process.env.REDIS_PUBSUB_PORT),
        }),
    },
  ],
  exports: [REDIS_CACHE, REDIS_PUBSUB],
})
export class RedisModule {}
```
- [ ] Create files
- [ ] Inject `REDIS_CACHE` with `@Inject(REDIS_CACHE) private readonly redis: Redis`
- [ ] Commit: `feat(redis): global redis module with cache + pubsub clients`

### Task 0.5 — Mailer module

**Files:** `src/mailer/mailer.module.ts`, `src/mailer/mailer.service.ts`

```ts
// mailer.service.ts
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  });

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <b>${code}</b>. It expires in 10 minutes.</p>`,
    });
  }
}
```
- [ ] Create module (provides + exports `MailerService`)
- [ ] Commit: `feat(mailer): nodemailer/mailtrap mailer service`

### Task 0.6 — Wire app + cookie-parser

**Files:** `src/app.module.ts`, `src/main.ts`

- `app.module.ts`: import `PrismaModule`, `RedisModule`, `MailerModule`, `AuthModule`.
- `main.ts`: add `app.use(cookieParser())` before routes.

```ts
// main.ts addition
import * as cookieParser from 'cookie-parser';
// ...after app creation:
app.use(cookieParser());
```
- [ ] Wire modules
- [ ] Boot app (`npm run start:dev`) → confirm it starts clean
- [ ] Commit: `chore(app): wire prisma/redis/mailer/auth modules + cookie-parser`

**Phase 0 done when:** app boots, DB migrated, Redis reachable, mailer + redis injectable.

---

## PHASE 1 — Manual register + OTP verification (auto-login)

**Outcome:** User can register, receive an OTP email, verify it, and be auto-logged-in.

> Depends on Phase 2's `TokenService` for the auto-login step. Implementation order suggestion: build OTP + register first, then bring `TokenService` (Task 2.1) forward so `verify-otp` can issue cookies. If you'd rather, we ship `verify-otp` returning `{ verified: true }` first and add auto-login when Phase 2 lands — tell me which.

### Task 1.1 — DTOs

**Files:** `dto/register.dto.ts`, `dto/verify-otp.dto.ts`, `dto/resend-otp.dto.ts`

```ts
// register.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';
export class RegisterDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}
```
```ts
// verify-otp.dto.ts
import { IsEmail, Length } from 'class-validator';
export class VerifyOtpDto {
  @IsEmail() email: string;
  @Length(6, 6) code: string;
}
```
```ts
// resend-otp.dto.ts
import { IsEmail } from 'class-validator';
export class ResendOtpDto {
  @IsEmail() email: string;
}
```

### Task 1.2 — AuthRepository (repo first)

**File:** `src/auth/auth.repository.ts`

Methods: `findByEmail`, `findById`, `createUser`, `markEmailVerified`.
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma-config/prisma.service';
import { Prisma, User } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }
  findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
  createUser(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }
  markEmailVerified(id: number): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { emailVerified: true } });
  }
}
```
**Test contract (you provide):** `findByEmail` returns null when absent; `createUser` persists hashed password; `markEmailVerified` flips the flag.

### Task 1.3 — OtpService (Redis)

**File:** `src/auth/otp.service.ts`

Keys: `otp:{email}` (code, TTL=`OTP_TTL_SECONDS`), `otp_attempts:{email}` (counter), `otp_cooldown:{email}` (resend lock).
```ts
import { Inject, Injectable, BadRequestException, TooManyRequestsException } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CACHE } from '../redis/redis.constants';

@Injectable()
export class OtpService {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  private gen(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async issue(email: string): Promise<string> {
    const cooldownKey = `otp_cooldown:${email}`;
    if (await this.redis.get(cooldownKey)) {
      throw new BadRequestException('Please wait before requesting another code');
    }
    const code = this.gen();
    const ttl = Number(process.env.OTP_TTL_SECONDS);
    await this.redis.set(`otp:${email}`, code, 'EX', ttl);
    await this.redis.del(`otp_attempts:${email}`);
    await this.redis.set(cooldownKey, '1', 'EX', Number(process.env.OTP_RESEND_COOLDOWN_SECONDS));
    return code;
  }

  async verify(email: string, code: string): Promise<boolean> {
    const key = `otp:${email}`;
    const stored = await this.redis.get(key);
    if (!stored) throw new BadRequestException('Code expired or not found');

    const attempts = await this.redis.incr(`otp_attempts:${email}`);
    if (attempts > Number(process.env.OTP_MAX_ATTEMPTS)) {
      await this.redis.del(key);
      throw new BadRequestException('Too many attempts, request a new code');
    }
    if (stored !== code) return false;

    await this.redis.del(key);
    await this.redis.del(`otp_attempts:${email}`);
    return true;
  }
}
```
> Note: use `BadRequestException` for attempts (Nest has no `TooManyRequestsException`; throw `new HttpException(msg, 429)` if you want 429). Decide during impl.

**Test contract:** correct code passes once then is consumed; wrong code fails and increments attempts; exceeding max attempts clears the code; expired/missing throws.

### Task 1.4 — AuthService: register + verify (service)

**File:** `src/auth/auth.service.ts`

```ts
async register(dto: RegisterDto) {
  const existing = await this.repo.findByEmail(dto.email);
  if (existing) throw new ConflictException('Email already registered');
  const hash = await bcrypt.hash(dto.password, 10);
  const user = await this.repo.createUser({
    name: dto.name, email: dto.email, password: hash,
  });
  const code = await this.otp.issue(user.email);
  await this.mailer.sendOtpEmail(user.email, code);
  return { message: 'Verification code sent' };
}

async verifyOtp(dto: VerifyOtpDto) {
  const user = await this.repo.findByEmail(dto.email);
  if (!user) throw new BadRequestException('Invalid email');
  if (user.emailVerified) throw new BadRequestException('Already verified');
  const ok = await this.otp.verify(dto.email, dto.code);
  if (!ok) throw new BadRequestException('Invalid code');
  const verified = await this.repo.markEmailVerified(user.id);
  return verified; // controller issues cookies (auto-login)
}

async resendOtp(dto: ResendOtpDto) {
  const user = await this.repo.findByEmail(dto.email);
  if (!user || user.emailVerified) return { message: 'If eligible, a code was sent' };
  const code = await this.otp.issue(user.email);
  await this.mailer.sendOtpEmail(user.email, code);
  return { message: 'Verification code sent' };
}
```
**Test contract:** duplicate email → 409; register hashes password + calls mailer; verifyOtp on already-verified → 400; happy path flips flag.

### Task 1.5 — Controller routes (controller → route)

**File:** `src/auth/auth.controller.ts`

`POST /auth/register`, `POST /auth/verify-otp` (sets cookies via TokenService — auto-login), `POST /auth/resend-otp`. Use `@Res({ passthrough: true })` to set cookies.

- [ ] Commit per task as you go: `feat(auth): register + otp verification`

**Phase 1 done when:** register → email arrives in Mailtrap → verify-otp returns user **and sets cookies**.

---

## PHASE 2 — Manual login + JWT (access/refresh, cookies, guards)

**Outcome:** Login issues cookies; protected routes work; refresh rotates; logout clears.

### Task 2.1 — TokenService (sign + cookie helpers)

**File:** `src/auth/token.service.ts`

```ts
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(user: { id: number; email: string; role: string }) {
    return this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: process.env.JWT_ACCESS_EXPIRES_IN },
    );
  }
  signRefresh(user: { id: number }) {
    const jti = randomUUID();
    const token = this.jwt.sign(
      { sub: user.id, jti },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: process.env.JWT_REFRESH_EXPIRES_IN },
    );
    return { token, jti };
  }

  setAuthCookies(res: Response, access: string, refresh: string) {
    const base = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, domain: process.env.COOKIE_DOMAIN };
    res.cookie('access_token', access, { ...base, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refresh, { ...base, path: '/api/v1/auth/refresh', maxAge: 7 * 24 * 60 * 60 * 1000 });
  }
  clearAuthCookies(res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
  }
}
```
Refresh persistence in Redis: on issue, `SET refresh:{userId}:{jti} 1 EX <7d>`; on refresh, validate the jti exists, delete old, issue new (rotation).

**JwtModule** registered in `AuthModule` (`JwtModule.register({})` — secrets passed per-sign).

### Task 2.2 — Strategies + guards

**Files:** `strategies/local.strategy.ts`, `strategies/jwt.strategy.ts`, `strategies/jwt-refresh.strategy.ts`, and matching guards.

`jwt.strategy.ts` extracts the access token from the cookie:
```ts
ExtractJwt.fromExtractors([(req: Request) => req?.cookies?.access_token ?? null])
```
`local.strategy.ts` validates email+password and that `emailVerified === true` (throw 403 otherwise).

### Task 2.3 — login / refresh / logout / me (service + controller)

- `login`: LocalAuthGuard populates `req.user` → issue cookies.
- `refresh`: JwtRefreshGuard → validate jti in Redis → rotate → set cookies.
- `logout`: clear cookies (and best-effort `DEL refresh:{userId}:{jti}`).
- `me`: JwtAuthGuard → return `req.user`.

### Task 2.4 — `@CurrentUser()` decorator

**File:** `src/auth/decorators/current-user.decorator.ts`

**Test contract:** login unverified → 403; wrong password → 401; valid login sets both cookies; `/auth/me` without cookie → 401; refresh with valid cookie returns new tokens; refresh with revoked jti → 401.

- [ ] Commit: `feat(auth): jwt access/refresh login, refresh rotation, logout, me`

**Phase 2 done when:** full manual cycle works via cookies — register → verify (auto-login) → me → refresh → logout.

---

## PHASE 3 — Google OAuth (block-and-require-linking)

**Outcome:** Google sign-in logs in known Google users, creates new ones, and blocks emails that already exist as manual accounts.

### Task 3.1 — Repo additions

`findByGoogleId(googleId)`, `createGoogleUser({ name, email, googleId })` (no password, `emailVerified: true`).

### Task 3.2 — GoogleStrategy + GoogleAuthGuard

**File:** `strategies/google.strategy.ts` (`passport-google-oauth20`), scope `['email','profile']`, uses `GOOGLE_*` env. `validate()` returns `{ email, name, googleId }`.

### Task 3.3 — Service: resolveGoogleUser (the core branch)

```ts
async resolveGoogleUser(p: { email: string; name: string; googleId: string }) {
  const byGoogle = await this.repo.findByGoogleId(p.googleId);
  if (byGoogle) return byGoogle;                       // existing google user → login

  const byEmail = await this.repo.findByEmail(p.email);
  if (byEmail) {                                        // manual account exists → BLOCK
    throw new ConflictException(
      'An account with this email already exists. Log in with your password and link Google in settings.',
    );
  }
  return this.repo.createGoogleUser(p);                // brand new → create verified
}
```

### Task 3.4 — Controller: `/auth/google` + `/auth/google/callback`

Callback issues cookies on success; on `ConflictException`, redirect to a frontend URL like `${FRONTEND_URL}/login?error=account_exists` (decide exact UX during impl).

**Test contract:** known googleId → returns that user; new email → creates verified user with `googleId`; existing manual email → 409.

- [ ] Commit: `feat(auth): google oauth with account-link guard`

**Phase 3 done when:** all three Google branches behave correctly.

---

## PHASE 4 *(optional)* — Link Google from settings

**Outcome:** Completes the blocked flow — a logged-in, password-authenticated user attaches their `googleId`.

- `POST /auth/link-google` (JwtAuthGuard) → run Google OAuth in "link mode" or accept a verified Google token → set `googleId` on the current user if not already taken.
- Repo: `setGoogleId(userId, googleId)` guarded by `googleId` uniqueness.

**Test contract:** linking succeeds when googleId is free; 409 when that googleId is already attached elsewhere; unauthenticated → 401.

- [ ] Commit: `feat(auth): link google account from settings`

---

## Full-stack context & frontend touchpoints

This is a **full-stack application** (separate `frontend/` SPA + this NestJS backend), not a backend-only service. The frontend isn't scaffolded yet, but auth must be built to serve a browser client on a **different origin** from the API. Implications already accounted for in this plan:

- **Cross-origin cookies:** `main.ts` already sets `enableCors({ origin: [FRONTEND_URL], credentials: true })`. Auth cookies are `httpOnly` + `sameSite: 'lax'`; if the frontend is ever served from a truly different site (not just a different port), revisit `sameSite: 'none'` + `secure` in production. The frontend's fetch/axios must send `credentials: 'include'` / `withCredentials: true`.
- **OTP is a frontend screen:** register returns `{ message }` (no tokens); the SPA shows a 6-digit code entry screen that calls `POST /auth/verify-otp`. On success the backend sets cookies (auto-login) and the SPA routes to the app.
- **Google OAuth is a full redirect flow, not an API call:** the browser navigates to `GET /auth/google` (not fetch). The callback sets cookies and must **redirect back to a frontend route**, e.g. success → `${FRONTEND_URL}/auth/callback`, block → `${FRONTEND_URL}/login?error=account_exists`. Exact routes to be agreed with the frontend when it's built.
- **No tokens in JSON bodies:** because tokens live in httpOnly cookies, the frontend never reads/stores them — it relies on `GET /auth/me` to know who's logged in.

> When the frontend module gets its own plan, its auth pages (register, OTP, login, Google button, `/auth/callback` handler) consume exactly these endpoints.

---

## Cross-cutting notes

- **Hashing:** bcrypt cost 10.
- **Cookie security:** `secure` only in production (so localhost dev over http works); `sameSite: 'lax'`.
- **No business logic in controllers** — they validate (DTO), call the service, and set/clear cookies via `TokenService`.
- **Repository owns all Prisma calls** — service never touches `prisma` directly.
- **Rate limiting** (login/OTP brute force) is a separate module later (architecture.md §5); OTP attempt/cooldown counters here are the minimum until then.
- **Open follow-up:** a `cron` to prune expired Redis keys is unnecessary (TTL handles it); refresh-token server-side revoke-on-logout is deferred per the "clear cookie only" decision.
