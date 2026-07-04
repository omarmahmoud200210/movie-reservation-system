# User Settings — Design

**Date:** 2026-07-04
**Build order:** Prerequisite for Phase 8 (Rate Limiting) — `architecture.md`'s
`PUT /user/settings` rate-limit rule has no endpoint to attach to; this phase
builds that endpoint (split into name/email/password concerns) before Phase 8
wires rate limits across all real routes.
**Depends on:** Auth (✅) — reuses `OtpService`, `TokenService`, `MailerService`,
and the `bcrypt` hashing convention `AuthService.register`/`validateUser` already
use.

## Goal

Let an authenticated user update their display name, change their email
(safely, without breaking the existing `emailVerified` invariant), and change
their password (revoking other active sessions) — reusing existing auth
primitives rather than inventing new ones.

## Scope

**In:**
- `PATCH /users/me` — update `name`.
- `POST /users/me/email` — request an email change; sends an OTP to the *new*
  address.
- `POST /users/me/email/confirm` — confirm the OTP, apply the email change.
- `GET /users/me/email/pending` — whether an email change is awaiting
  confirmation (backend support for a future client-side indicator; no UI
  designed here).
- `POST /users/me/password` — change password; revokes every other session.
- New `UsersModule` (`src/users/`).

**Out:**
- `GET /users/me` — not added. `GET /auth/me` (`auth.controller.ts:101`)
  already serves this; adding a second endpoint for the same data would be
  duplication with no benefit.
  
- Rate limiting on these new routes — that's Phase 8, which comes right after
  this ships (this phase exists specifically to give Phase 8's `PUT /user/settings`
  rule a real target).

- Google-account password changes: `changePassword` requires a `password`
  hash to compare against (`bcrypt.compare(currentPassword, user.password)`).
  A Google-only account (`password: null`) has nothing to compare against —
  out of scope here; `AuthService.validateUser` already has a precedent guard
  (`if (!user.password) throw UnauthorizedException`) for this exact case,
  which the new endpoint mirrors rather than solving further.

## Why email changes go through OTP confirmation, not just a password check

`AuthService.validateUser()` already blocks login for any account where
`emailVerified` is false (`auth.service.ts:68`). That flag currently means
something precise: *this email address's owner proved they control it, via
OTP, at registration.* If email changes took effect immediately on a
password check alone, `emailVerified` would keep reading `true` for an email
nobody has actually confirmed — silently breaking an invariant the rest of
the auth system depends on. Requiring the same OTP proof-of-control on change
that registration already requires on signup keeps that invariant true at
every point in the account's lifetime, not just at creation.

## Why password change revokes other sessions

A password change is exactly the recovery path from "my account was
compromised." If a stolen session could change the password without logging
out every *other* session, the real owner's still-active (but now
attacker-controlled) sessions elsewhere would silently persist. Revoking all
other refresh tokens on change closes that gap. The session performing the
change stays logged in — it already proved current-password knowledge, so
there's no reason to also log it out.

## Components

```
src/users/
├── users.module.ts
├── users.controller.ts             # JwtAuthGuard; @CurrentUser() -> userId
├── users.service.ts                # updateName, requestEmailChange,
│                                    # confirmEmailChange, getPendingEmailChange,
│                                    # changePassword
├── users.repository.ts             # updateName, updateEmail, updatePassword
│                                    # (thin Prisma wrappers, no business logic)
└── dto/
    ├── update-name.dto.ts
    ├── request-email-change.dto.ts
    ├── confirm-email-change.dto.ts
    └── change-password.dto.ts
```

- `AuthModule` currently has **no `exports` array at all** (same situation
  `ReservationsModule` was in before the cron phase). It needs one added:
  `exports: [AuthService, OtpService, TokenService]`.
- `UsersModule` imports `AuthModule` (for the three services above) and
  `MailerModule` (already exports `MailerService`). `PrismaModule`/
  `RedisModule` are global, no explicit import needed.
- Registered in `app.module.ts`.

### `UsersService`

```ts
constructor(
  private readonly usersRepo: UsersRepository,
  private readonly redis: RedisCache,
  private readonly otp: OtpService,
  private readonly mailer: MailerService,
  private readonly authService: AuthService,
  private readonly tokenService: TokenService,
) {}

async updateName(userId: number, name: string): Promise<AuthUser> {
  await this.usersRepo.updateName(userId, name);
  return this.authService.getAuthUser(userId);
}

async requestEmailChange(
  userId: number,
  newEmail: string,
  currentPassword: string,
): Promise<{ message: string }> {
  const user = await this.usersRepo.findById(userId);
  if (!user?.password) throw new UnauthorizedException('Invalid credentials');
  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) throw new UnauthorizedException('Invalid credentials');

  const existing = await this.usersRepo.findByEmail(newEmail);
  if (existing) throw new ConflictException('Email already registered');

  await this.redis.set(
    `pending_email:${userId}`,
    newEmail,
    'EX',
    Number(process.env.OTP_TTL_SECONDS),
  );
  const code = await this.otp.issue(newEmail);
  await this.mailer.sendOtpEmail(newEmail, code);
  return { message: 'Verification code sent to new email' };
}

async confirmEmailChange(userId: number, code: string): Promise<AuthUser> {
  const pendingEmail = await this.redis.get(`pending_email:${userId}`);
  if (!pendingEmail) {
    throw new BadRequestException('No pending email change or it expired');
  }
  const ok = await this.otp.verify(pendingEmail, code);
  if (!ok) throw new BadRequestException('Invalid code');

  await this.usersRepo.updateEmail(userId, pendingEmail);
  await this.redis.del(`pending_email:${userId}`);
  return this.authService.getAuthUser(userId);
}

async getPendingEmailChange(
  userId: number,
): Promise<{ pending: true; newEmail: string } | { pending: false }> {
  const newEmail = await this.redis.get(`pending_email:${userId}`);
  return newEmail ? { pending: true, newEmail } : { pending: false };
}

async changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  res: Response,
): Promise<void> {
  const user = await this.usersRepo.findById(userId);
  if (!user?.password) throw new UnauthorizedException('Invalid credentials');
  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) throw new UnauthorizedException('Invalid credentials');

  const hash = await bcrypt.hash(newPassword, 10);
  await this.usersRepo.updatePassword(userId, hash);

  await this.tokenService.revokeAllSessions(userId);
  const authUser = await this.authService.getAuthUser(userId);
  await this.tokenService.issueAuthCookies(res, authUser);
}
```

(`changePassword` needs `@Res({ passthrough: true })` in the controller, same
pattern `AuthController.logout` already uses for cookie mutation.)

### `TokenService.revokeAllSessions` (new method)

```ts
async revokeAllSessions(userId: number): Promise<void> {
  const client = this.redis.getClient();
  const keys = await client.keys(`refresh:${userId}:*`);
  if (keys.length > 0) {
    await client.del(...keys);
  }
}
```

`KEYS` (not `SCAN`) is fine here: the pattern is scoped to one user's active
sessions, which is always a small, bounded set — not a whole-keyspace scan.
`RedisCache.getClient()` already exists and is used the same way by
`RateLimiterService`.

### `UsersRepository`

Thin Prisma wrappers, matching `AuthRepository`'s existing shape:

```ts
findById(id: number): Promise<User | null>
findByEmail(email: string): Promise<User | null>
updateName(id: number, name: string): Promise<User>
updateEmail(id: number, email: string): Promise<User>
updatePassword(id: number, password: string): Promise<User>
```

## Endpoints

### `PATCH /users/me` (auth)
Body: `UpdateNameDto { name }`. Response `200`: `AuthUser` (`{ id, name, email,
role }` — the exact same shape `AuthController.me` already returns; never the
raw Prisma `User` row, which carries the password hash).

### `POST /users/me/email` (auth)
Body: `RequestEmailChangeDto { newEmail, currentPassword }`. Response `200`:
`{ message: 'Verification code sent to new email' }`.

### `POST /users/me/email/confirm` (auth)
Body: `ConfirmEmailChangeDto { code }`. Response `200`: `AuthUser`, same shape
and reasoning as `PATCH /users/me`.

### `GET /users/me/email/pending` (auth)
No body. Calls `UsersService.getPendingEmailChange`. Response `200`:
`{ pending: true, newEmail: string } | { pending: false }`. Backend-only
concern — lets a client (built later) know whether to keep showing a "verify
your new email" indicator across page loads/new sessions, without the client
having to remember state itself from the moment `POST /users/me/email`
succeeded. Reads the same `pending_email:{userId}` Redis key
`requestEmailChange`/`confirmEmailChange` already use — no new storage.

### `POST /users/me/password` (auth)
Body: `ChangePasswordDto { currentPassword, newPassword }`. Response `200`:
`{ message: 'Password changed' }`. Sets fresh auth cookies via
`@Res({ passthrough: true })`, same as `AuthController.logout`/login.

## Errors

| Case | Status |
|---|---|
| `currentPassword` wrong (email or password change) | 401 |
| Account has no password (Google-only) | 401 |
| `newEmail` already registered to another account | 409 |
| Email confirm: no pending change / expired | 400 |
| Email confirm: wrong or expired OTP code | 400 |
| Email confirm: too many attempts | 400 (from `OtpService.verify`'s existing attempt-limit) |
| `newPassword` / `name` fails DTO validation | 400 (global `ValidationPipe`) |

## Testing (TDD)

Mirror `src/auth/test/*.spec.ts` conventions — mocked repo, OTP service,
mailer, token service, and auth service.

- **`updateName`**: updates via the repo, then returns `authService.getAuthUser(userId)`'s
  result (not the raw repo row) — assert both calls happen, in that order.
- **`requestEmailChange`**: wrong current password → 401; no password on
  account → 401; email already taken → 409; success → sets the Redis pending
  key, calls `otp.issue` + `mailer.sendOtpEmail` with the new email.
- **`confirmEmailChange`**: no pending key → 400; `otp.verify` returns false →
  400; success → updates email, deletes the pending key, returns
  `authService.getAuthUser(userId)`'s result (same non-leak reasoning as
  `updateName`).
- **`getPendingEmailChange`**: Redis key present → `{ pending: true, newEmail }`;
  absent/expired → `{ pending: false }`.
- **`changePassword`**: wrong current password → 401; success → hashes and
  stores the new password, calls `revokeAllSessions`, reissues auth cookies.
- **`TokenService.revokeAllSessions`**: deletes all matching keys; no-ops
  cleanly when there are none.
- **Controller tests**: `JwtAuthGuard` applied to all five routes; `userId`
  always sourced from `@CurrentUser()`, never from the body.

## Deferred-integration markers (in code)

| Seam | Where the comment goes | Note |
|---|---|---|
| Rate limiting on all five routes | above each route in `users.controller.ts` | Resolved by Phase 8, which follows this phase directly — not a future/uncertain phase, so use the same `DEFERRED(phase-8)` convention already on `reservations.controller.ts:26` |

## Companion changes to `architecture.md`

One small doc update: `architecture.md`'s API layer table already lists
`UsersModule | GET /users/me, PUT /user/settings` (line ~189), which
undersells what's actually being built (four endpoints, not one PUT, and no
`GET` — see Scope). Update that row to list the real endpoints, matching how
other modules' rows already read (e.g. the `ReservationsModule` row lists all
three of its real routes).

## Follow-ups noted for later phases

- Phase 8 (Rate Limiting): add `@RateLimit(...)`-equivalent guarding to all
  five new routes, resolving the `DEFERRED(phase-8)` markers this phase
  leaves. `architecture.md`'s `PUT /user/settings` rule most naturally maps to
  `POST /users/me/password` (the most sensitive of the five) — confirm exact
  mapping across all five routes when Phase 8 is brainstormed.
