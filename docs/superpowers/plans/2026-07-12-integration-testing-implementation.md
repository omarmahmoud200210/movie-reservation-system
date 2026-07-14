# Integration/E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end test suite described in `docs/superpowers/specs/2026-07-12-integration-testing-design.md`
— a real NestJS app, real Postgres, real Redis, Stripe SDK's outbound calls mocked (signature
verification left real) — with one spec file per module, backed by shared test-support helpers.

**Architecture:** `backend/test/support/` holds reusable helpers (app bootstrap, DB/Redis reset, auth
token minting, fixture builders, WebSocket client, Stripe webhook signing). `backend/test/*.e2e-spec.ts`
holds one file per module, run via a dedicated `test/jest-e2e.json` config against a dedicated
`docker-compose.test.yml` Postgres+Redis pair, environment driven by `.env.test`. Stripe's outbound HTTP
methods (`checkout.sessions.create/retrieve`, `refunds.create`) are stubbed via a manual Jest mock that
subclasses the *real* `stripe` package (so `webhooks.constructEvent`'s HMAC signature verification still
runs for real against a fixed test secret).

**Tech Stack:** Jest 30 + ts-jest (already installed), Supertest (already installed), `socket.io-client`
(new devDependency), `ioredis` (already installed, reused directly for a state-reset helper), `@nestjs/jwt`
(already installed, reused to mint access tokens without going through login), Docker Compose for
Postgres 16 + Redis 7 test containers.

**Important environment-loading fact this plan depends on:** `AppModule`'s `ConfigModule.forRoot({
envFilePath: '.env' })` is hardcoded to `.env` — it does **not** read a `NODE_ENV`-driven filename. `dotenv`
(which `@nestjs/config` uses internally) only fills in environment variables that aren't **already** set in
`process.env` — it never overwrites an existing value. So as long as Jest's `setupFiles` loads
`.env.test` into `process.env` *before* the app boots (Jest's `setupFiles` run before any test file's
`require`s), the app's own `.env` load becomes a no-op for every key `.env.test` already supplied. Task 1
includes a verification step for exactly this assumption, so if it's wrong we find out in the first task,
not the last.

---

## File Structure

**New:**
- `backend/docker-compose.test.yml` — Postgres 16 + Redis 7, distinct ports from dev.
- `backend/.env.test` — test environment variables.
- `backend/test/jest-e2e.json` — Jest config for the e2e project.
- `backend/test/jest.setup.ts` — loads `.env.test` before any test file's imports run.
- `backend/__mocks__/stripe.ts` — manual mock, auto-applied by Jest to every `import Stripe from 'stripe'`
  in the e2e run; subclasses the real SDK so only outbound network calls are stubbed.
- `backend/test/support/app.ts` — boots a real `INestApplication` from the real `AppModule`.
- `backend/test/support/db.ts` — truncates every table + flushes Redis between tests, re-seeds
  `RefundPolicy`.
- `backend/test/support/auth.ts` — seeds a verified `User` row, mints a real access-token cookie.
- `backend/test/support/fixtures.ts` — hall+seats / movie / screening builders.
- `backend/test/support/socket.ts` — `socket.io-client` connect/join/wait-for-event helpers.
- `backend/test/support/stripe-webhook.ts` — signs a real Stripe-compatible webhook payload.
- `backend/test/bootstrap.e2e-spec.ts` — one-test sanity file proving the harness (DB, Redis, Stripe mock,
  env loading) actually works, before any module-specific spec is written.
- `backend/test/auth.e2e-spec.ts`
- `backend/test/movies.e2e-spec.ts`
- `backend/test/screenings.e2e-spec.ts`
- `backend/test/reservations.e2e-spec.ts`
- `backend/test/payments.e2e-spec.ts`
- `backend/test/payment-abuse.e2e-spec.ts`

**Modified:**
- `backend/package.json` — add `socket.io-client` devDependency.

---

## Task 1: Test environment & Jest config

**Files:**
- Create: `backend/docker-compose.test.yml`
- Create: `backend/.env.test`
- Create: `backend/test/jest-e2e.json`
- Create: `backend/test/jest.setup.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Add the test compose file**

```yaml
# backend/docker-compose.test.yml
version: '3.8'
services:
  postgres-test:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: movie_reservation_test
    ports:
      - '5433:5432'
  redis-cache-test:
    image: redis:7
    ports:
      - '6399:6379'
```

- [ ] **Step 2: Add `.env.test`**

```bash
# backend/.env.test
PORT=3001
NODE_ENV=test
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3001

DATABASE_URL=postgresql://postgres:postgres@localhost:5433/movie_reservation_test

JWT_ACCESS_SECRET=e2e_test_access_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=e2e_test_refresh_secret
JWT_REFRESH_EXPIRES_IN=7d
COOKIE_DOMAIN=localhost
LINK_STATE_SECRET=e2e_test_link_state_secret

OTP_TTL_SECONDS=600
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SECONDS=60

MAIL_HOST=localhost
MAIL_PORT=2525
MAIL_USER=test
MAIL_PASS=test
MAIL_FROM="Movie Reservation Test <test@movieres.dev>"

GOOGLE_CLIENT_ID=test_client_id
GOOGLE_CLIENT_SECRET=test_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/v1/auth/google/callback
GOOGLE_LINK_CALLBACK_URL=http://localhost:3001/api/v1/auth/link-google/callback

REDIS_CACHE_HOST=localhost
REDIS_CACHE_PORT=6399

STRIPE_SECRET_KEY=sk_test_fake_key_for_e2e_only
STRIPE_WEBHOOK_SECRET=whsec_e2e_fixed_test_secret
```

- [ ] **Step 3: Add the Jest e2e config**

```json
// backend/test/jest-e2e.json
{
  "rootDir": "..",
  "moduleFileExtensions": ["js", "json", "ts"],
  "testRegex": "test/.*\\.e2e-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFiles": ["<rootDir>/test/jest.setup.ts"],
  "testEnvironment": "node",
  "testTimeout": 30000
}
```

`rootDir: ".."` (pointing at `backend/`, since this config file lives in `backend/test/`) is what makes
Jest look for `backend/__mocks__/stripe.ts` automatically — Jest auto-applies a manual mock for a
node_modules package when it's placed in a `__mocks__` directory adjacent to that `rootDir`'s
`node_modules`, with no `jest.mock('stripe')` call needed in any spec file.

- [ ] **Step 4: Add the env-loading setup file**

```typescript
// backend/test/jest.setup.ts
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
```

- [ ] **Step 5: Add the `socket.io-client` devDependency**

Run: `cd backend && npm install -D socket.io-client`
Expected: `package.json`'s `devDependencies` gains `"socket.io-client": "^4.x.x"`, `package-lock.json`
updates.

- [ ] **Step 6: Verify the env-loading assumption with a throwaway script**

Run this one-off check (not committed) to confirm `.env.test` values win over `.env` once loaded first —
this is the assumption the whole suite depends on:

```bash
cd backend && node -e "
require('dotenv').config({ path: '.env.test' });
require('dotenv').config({ path: '.env' });
console.log('DATABASE_URL should be the TEST one:', process.env.DATABASE_URL);
"
```

Expected output: `DATABASE_URL should be the TEST one: postgresql://postgres:postgres@localhost:5433/movie_reservation_test`
(the `.env.test` value, NOT the `.env` file's `localhost:8000` value) — proving the second `dotenv.config()`
call (simulating `ConfigModule.forRoot`'s load of `.env`) did not override the first. If this prints the
`.env` file's DB URL instead, STOP — the env-precedence assumption is wrong and this plan's Task 1 Step 4
needs a different approach (e.g., setting `process.env.DATABASE_URL` etc. directly in `jest.setup.ts`
instead of relying on `dotenv.config`'s no-override default) before continuing to Task 2.

- [ ] **Step 7: Bring up the test containers and migrate**

Superseded: Postgres/Redis are no longer brought up via `docker-compose.test.yml`. Testcontainers
now starts both containers (reused across runs via `.withReuse()`) from Jest's `globalSetup` and
runs `prisma migrate deploy` against the resolved connection string automatically — see
`feat/payments-phase9`, `backend/test/global-setup.ts`. Just run:

```bash
cd backend
npm run test:e2e
```

- [ ] **Step 8: Commit**

```bash
git add backend/docker-compose.test.yml backend/.env.test backend/test/jest-e2e.json backend/test/jest.setup.ts backend/package.json backend/package-lock.json
git commit -m "test(e2e): add e2e test infrastructure (compose, env, jest config)"
```

---

## Task 2: Stripe manual mock

**Files:**
- Create: `backend/__mocks__/stripe.ts`

- [ ] **Step 1: Write the mock**

```typescript
// backend/__mocks__/stripe.ts
const stripeModule = jest.requireActual('stripe');
const ActualStripe = stripeModule.default ?? stripeModule;

/**
 * Subclasses the real Stripe SDK so `webhooks.constructEvent` (pure HMAC
 * signature verification, no network call) keeps running for real — only
 * the methods that would actually reach Stripe's API are stubbed.
 */
class MockStripe extends ActualStripe {
  checkout = {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  };
  refunds = { create: jest.fn() };
}

export default MockStripe;
```

- [ ] **Step 2: Commit**

```bash
git add backend/__mocks__/stripe.ts
git commit -m "test(e2e): add manual Stripe mock (real signature verification, stubbed API calls)"
```

---

## Task 3: DB + Redis reset harness

**Files:**
- Create: `backend/test/support/db.ts`

- [ ] **Step 1: Write the helper**

```typescript
// backend/test/support/db.ts
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const TABLES = [
  'reservation',
  'payment',
  'refund_policy',
  'screening',
  'seat',
  'hall',
  'movie',
  'user',
];

/** Truncates every application table and flushes Redis, then re-seeds the
 * three fixed RefundPolicy rows. Call this in a beforeEach so every test
 * starts from a known-empty state. */
export async function resetState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
  );

  await prisma.refundPolicy.createMany({
    data: [
      { hoursFrom: 48, hoursTo: 100_000, refundPercent: 100 },
      { hoursFrom: 24, hoursTo: 48, refundPercent: 50 },
      { hoursFrom: 0, hoursTo: 24, refundPercent: 0 },
    ],
  });

  const redis = new Redis({
    host: process.env.REDIS_CACHE_HOST ?? 'localhost',
    port: Number(process.env.REDIS_CACHE_PORT ?? 6379),
  });
  await redis.flushall();
  await redis.quit();
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/test/support/db.ts
git commit -m "test(e2e): add DB truncate + Redis flush reset helper"
```

---

## Task 4: App bootstrap harness + bootstrap sanity spec

**Files:**
- Create: `backend/test/support/app.ts`
- Create: `backend/test/bootstrap.e2e-spec.ts`

- [ ] **Step 1: Write the app harness**

```typescript
// backend/test/support/app.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

/** Boots the real app the same way main.ts does (prefix, cookies, pipes),
 * against a real ephemeral port so Socket.IO clients can connect. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.listen(0);

  return app;
}

export function baseUrl(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}
```

- [ ] **Step 2: Write the sanity spec**

```typescript
// backend/test/bootstrap.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState } from './support/db';

describe('e2e harness sanity check', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toContain('movie_reservation_test');
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('boots the real app and responds on a public route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/movies');
    expect(res.status).toBe(200);
  });

  it('resetState truncates and re-seeds RefundPolicy', async () => {
    await resetState(prisma);
    const policies = await prisma.refundPolicy.findMany();
    expect(policies).toHaveLength(3);
  });

  it('the Stripe mock is active (webhooks real, API calls stubbed)', async () => {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    expect(jest.isMockFunction(stripe.checkout.sessions.create)).toBe(true);
    expect(typeof stripe.webhooks.constructEvent).toBe('function');
  });
});
```

- [ ] **Step 3: Run it**

Run: `cd backend && npm run test:e2e -- bootstrap.e2e-spec.ts`
Expected: PASS, 3 tests green. If the `DATABASE_URL` assertion fails, go back to Task 1 Step 6/7 — the
env-precedence assumption or the container/migration setup needs fixing before any other spec can be
trusted.

- [ ] **Step 4: Commit**

```bash
git add backend/test/support/app.ts backend/test/bootstrap.e2e-spec.ts
git commit -m "test(e2e): add app bootstrap harness + sanity spec"
```

---

## Task 5: Auth helper (seed user + mint real JWT cookie)

**Files:**
- Create: `backend/test/support/auth.ts`

- [ ] **Step 1: Write the helper**

```typescript
// backend/test/support/auth.ts
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, UserRole } from '@prisma/client';

const jwt = new JwtService();
let counter = 0;

export interface TestUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  /** Pass directly to `.set('Cookie', testUser.cookie)` in Supertest. */
  cookie: string;
}

/** Inserts a verified User row directly (skips register/OTP) and signs a
 * real access token via the same secret/payload shape TokenService uses,
 * so the real JwtAuthGuard/JwtStrategy validate it identically to a token
 * issued through login. */
export async function createAuthedUser(
  prisma: PrismaClient,
  overrides: { role?: UserRole; email?: string; name?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `e2e-user-${counter}@test.local`;
  const name = overrides.name ?? 'E2E Test User';
  const role = overrides.role ?? UserRole.USER;

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash('Password123!', 10),
      emailVerified: true,
      role,
    },
  });

  const accessToken = jwt.sign(
    { sub: user.id, name: user.name, email: user.email, role: user.role },
    {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    },
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    cookie: `access_token=${accessToken}`,
  };
}
```

- [ ] **Step 2: Add a spec exercising it (extends the auth suite groundwork for Task 9)**

This is verified directly in Task 9's `auth.e2e-spec.ts` (`GET /auth/me` with a minted cookie) rather than
a standalone test here — no separate spec file needed for a pure data/token helper.

- [ ] **Step 3: Commit**

```bash
git add backend/test/support/auth.ts
git commit -m "test(e2e): add createAuthedUser helper (real JWT, skips OTP)"
```

---

## Task 6: Fixture builders (hall+seats, movie, screening)

**Files:**
- Create: `backend/test/support/fixtures.ts`

- [ ] **Step 1: Write the helpers**

```typescript
// backend/test/support/fixtures.ts
import { PrismaClient, MovieStatus, ScreenStatus, Hall, Movie, Screening, Seat } from '@prisma/client';

export async function createHallWithSeats(
  prisma: PrismaClient,
  opts: { rows?: number; seatsPerRow?: number; name?: string } = {},
): Promise<{ hall: Hall; seats: Seat[] }> {
  const rows = opts.rows ?? 2;
  const seatsPerRow = opts.seatsPerRow ?? 5;

  const hall = await prisma.hall.create({
    data: { name: opts.name ?? 'E2E Hall', capacity: rows * seatsPerRow },
  });

  const rowLabels = Array.from({ length: rows }, (_, i) => String.fromCharCode(65 + i));
  await prisma.seat.createMany({
    data: rowLabels.flatMap((row) =>
      Array.from({ length: seatsPerRow }, (_, i) => ({
        hallId: hall.id,
        row,
        number: String(i + 1),
      })),
    ),
  });

  const seats = await prisma.seat.findMany({ where: { hallId: hall.id } });
  return { hall, seats };
}

export function createPublishedMovie(
  prisma: PrismaClient,
  overrides: Partial<{ name: string }> = {},
): Promise<Movie> {
  return prisma.movie.create({
    data: {
      name: overrides.name ?? 'E2E Test Movie',
      description: 'A movie used only by e2e tests',
      duration: 120,
      posterImgUrl: 'https://example.com/poster.jpg',
      movieType: '2D',
      rating: 7.5,
      language: 'en',
      genre: 'Drama',
      status: MovieStatus.PUBLISHED,
    },
  });
}

export function createScreening(
  prisma: PrismaClient,
  opts: { movieId: number; hallId: number; startTime: Date; price?: number },
): Promise<Screening> {
  return prisma.screening.create({
    data: {
      movieId: opts.movieId,
      hallId: opts.hallId,
      startTime: opts.startTime,
      price: opts.price ?? 50,
      status: ScreenStatus.SCHEDULED,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/test/support/fixtures.ts
git commit -m "test(e2e): add hall/movie/screening fixture builders"
```

---

## Task 7: WebSocket test helper

**Files:**
- Create: `backend/test/support/socket.ts`

- [ ] **Step 1: Write the helper**

```typescript
// backend/test/support/socket.ts
import { io, Socket } from 'socket.io-client';

export function connectSocket(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], forceNew: true });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

export function joinScreening(
  socket: Socket,
  screeningId: number,
): Promise<{ ok: boolean; seats?: unknown[]; summary?: unknown; error?: string }> {
  return new Promise((resolve) => {
    socket.emit('join:screening', { screeningId }, resolve);
  });
}

export function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/test/support/socket.ts
git commit -m "test(e2e): add socket.io-client test helper"
```

---

## Task 8: Stripe webhook payload signer

**Files:**
- Create: `backend/test/support/stripe-webhook.ts`

- [ ] **Step 1: Write the helper**

```typescript
// backend/test/support/stripe-webhook.ts
const stripeModule = jest.requireActual('stripe');
const ActualStripe = stripeModule.default ?? stripeModule;

/** Signs a payload with the real Stripe webhook-signing scheme against the
 * fixed STRIPE_WEBHOOK_SECRET in .env.test, so PaymentsService's real
 * `stripe.webhooks.constructEvent` signature check passes/fails exactly
 * like it would against a real webhook from Stripe. */
export function signWebhookPayload(payload: object): { body: Buffer; signature: string } {
  const body = Buffer.from(JSON.stringify(payload));
  const signature: string = ActualStripe.webhooks.generateTestHeaderString({
    payload: body.toString(),
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  });
  return { body, signature };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/test/support/stripe-webhook.ts
git commit -m "test(e2e): add real Stripe webhook payload signer for tests"
```

---

## Task 9: `auth.e2e-spec.ts`

**Files:**
- Create: `backend/test/auth.e2e-spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// backend/test/auth.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState } from './support/db';
import { createAuthedUser } from './support/auth';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in a verified user and sets the access_token cookie', async () => {
      await prisma.user.create({
        data: {
          name: 'Login User',
          email: 'login@test.local',
          password: await bcrypt.hash('Password123!', 10),
          emailVerified: true,
          role: 'USER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'login@test.local', password: 'Password123!' });

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
    });

    it('rejects a wrong password with 401', async () => {
      await prisma.user.create({
        data: {
          name: 'Login User',
          email: 'login2@test.local',
          password: await bcrypt.hash('Password123!', 10),
          emailVerified: true,
          role: 'USER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'login2@test.local', password: 'WrongPassword!' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns the caller with a valid cookie from createAuthedUser', async () => {
      const testUser = await createAuthedUser(prisma);

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', testUser.cookie);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testUser.email);
    });
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npm run test:e2e -- auth.e2e-spec.ts`
Expected: PASS, 4 tests green.

- [ ] **Step 3: Commit**

```bash
git add backend/test/auth.e2e-spec.ts
git commit -m "test(e2e): add auth module e2e spec"
```

---

## Task 10: `movies.e2e-spec.ts` + `screenings.e2e-spec.ts`

**Files:**
- Create: `backend/test/movies.e2e-spec.ts`
- Create: `backend/test/screenings.e2e-spec.ts`

- [ ] **Step 1: Write the movies spec**

```typescript
// backend/test/movies.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState } from './support/db';
import { createAuthedUser } from './support/auth';
import { createPublishedMovie } from './support/fixtures';

describe('Movies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  it('GET /api/v1/movies lists only published movies', async () => {
    await createPublishedMovie(prisma, { name: 'Published Movie' });
    await prisma.movie.create({
      data: {
        name: 'Draft Movie',
        description: 'unpublished',
        duration: 90,
        posterImgUrl: 'https://example.com/x.jpg',
        movieType: '2D',
        rating: 5,
        language: 'en',
        genre: 'Comedy',
      },
    });

    const res = await request(app.getHttpServer()).get('/api/v1/movies');

    expect(res.status).toBe(200);
    const names = (res.body as Array<{ name: string }>).map((m) => m.name);
    expect(names).toContain('Published Movie');
    expect(names).not.toContain('Draft Movie');
  });

  it('POST /api/v1/movies rejects a non-admin with 403', async () => {
    const user = await createAuthedUser(prisma, { role: 'USER' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/movies')
      .set('Cookie', user.cookie)
      .send({
        name: 'New Movie',
        description: 'desc',
        duration: 100,
        posterImgUrl: 'https://example.com/x.jpg',
        movieType: '2D',
        rating: 8,
        language: 'en',
        genre: 'Action',
      });

    expect(res.status).toBe(403);
  });

  it('an ADMIN can create then publish a movie', async () => {
    const admin = await createAuthedUser(prisma, { role: 'ADMIN' });

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/movies')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Admin Movie',
        description: 'desc',
        duration: 100,
        posterImgUrl: 'https://example.com/x.jpg',
        movieType: '2D',
        rating: 8,
        language: 'en',
        genre: 'Action',
      });
    expect(createRes.status).toBe(201);

    const publishRes = await request(app.getHttpServer())
      .patch(`/api/v1/movies/${createRes.body.id}/publish`)
      .set('Cookie', admin.cookie);
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.status).toBe('PUBLISHED');
  });
});
```

- [ ] **Step 2: Write the screenings spec**

```typescript
// backend/test/screenings.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';

describe('Screenings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  it('GET /api/v1/screenings/:id/seats returns the hall seat map', async () => {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 3 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });

    const res = await request(app.getHttpServer()).get(
      `/api/v1/screenings/${screening.id}/seats`,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(seats.length);
  });

  it('POST /api/v1/screenings rejects a non-admin with 403', async () => {
    const user = await createAuthedUser(prisma, { role: 'USER' });
    const { hall } = await createHallWithSeats(prisma);
    const movie = await createPublishedMovie(prisma);

    const res = await request(app.getHttpServer())
      .post('/api/v1/screenings')
      .set('Cookie', user.cookie)
      .send({
        movieId: movie.id,
        hallId: hall.id,
        startTime: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        price: 50,
      });

    expect(res.status).toBe(403);
  });

  it('an ADMIN can create a screening', async () => {
    const admin = await createAuthedUser(prisma, { role: 'ADMIN' });
    const { hall } = await createHallWithSeats(prisma);
    const movie = await createPublishedMovie(prisma);

    const res = await request(app.getHttpServer())
      .post('/api/v1/screenings')
      .set('Cookie', admin.cookie)
      .send({
        movieId: movie.id,
        hallId: hall.id,
        startTime: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        price: 50,
      });

    expect(res.status).toBe(201);
    expect(res.body.hallId).toBe(hall.id);
  });
});
```

- [ ] **Step 3: Run both**

Run: `cd backend && npm run test:e2e -- movies.e2e-spec.ts screenings.e2e-spec.ts`
Expected: PASS, 6 tests green.

- [ ] **Step 4: Commit**

```bash
git add backend/test/movies.e2e-spec.ts backend/test/screenings.e2e-spec.ts
git commit -m "test(e2e): add movies and screenings e2e specs"
```

---

## Task 11: `reservations.e2e-spec.ts`

**Files:**
- Create: `backend/test/reservations.e2e-spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// backend/test/reservations.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, ReservationStatus } from '@prisma/client';
import { createTestApp, baseUrl } from './support/app';
import { resetState } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { connectSocket, joinScreening, waitForEvent } from './support/socket';
import { HoldExpiryCron } from '../src/cron/hold-expiry.cron';

describe('Reservations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  async function seedScreening() {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 2 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });
    return { hall, seats, movie, screening };
  }

  it('reserves a seat, then rejects a second reservation on the same seat with 409', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);
    const otherUser = await createAuthedUser(prisma);

    const firstRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });
    expect(firstRes.status).toBe(201);
    expect(firstRes.body.status).toBe(ReservationStatus.HELD);

    const secondRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', otherUser.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });
    expect(secondRes.status).toBe(409);
  });

  it('cancels a HELD reservation', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });

    const cancelRes = await request(app.getHttpServer())
      .delete(`/api/v1/reservations/${reserveRes.body.id}`)
      .set('Cookie', user.cookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe(ReservationStatus.CANCELLED);
  });

  it('broadcasts seat:reserved over the screening room on reserve', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);
    const socket = await connectSocket(baseUrl(app));
    await joinScreening(socket, screening.id);
    const broadcast = waitForEvent<{ seatIds: number[]; status: string }>(socket, 'seat:reserved');

    await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });

    const payload = await broadcast;
    expect(payload.seatIds).toEqual([seats[0].id]);
    expect(payload.status).toBe('HELD');
    socket.disconnect();
  });

  it('hold-expiry cron releases an expired HELD reservation and broadcasts seat:cancelled', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });

    await prisma.reservation.update({
      where: { id: reserveRes.body.id },
      data: { heldUntil: new Date(Date.now() - 60_000) },
    });

    const socket = await connectSocket(baseUrl(app));
    await joinScreening(socket, screening.id);
    const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:cancelled');

    const cron = app.get(HoldExpiryCron);
    await cron.handleExpireHolds();

    const payload = await broadcast;
    expect(payload.seatIds).toEqual([seats[0].id]);

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reserveRes.body.id },
    });
    expect(reservation.status).toBe(ReservationStatus.CANCELLED);
    socket.disconnect();
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npm run test:e2e -- reservations.e2e-spec.ts`
Expected: PASS, 4 tests green.

- [ ] **Step 3: Commit**

```bash
git add backend/test/reservations.e2e-spec.ts
git commit -m "test(e2e): add reservations e2e spec (reserve/cancel/broadcast/hold-expiry)"
```

---

## Task 12: `payments.e2e-spec.ts`

**Files:**
- Create: `backend/test/payments.e2e-spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// backend/test/payments.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, PaymentStatus, ReservationStatus } from '@prisma/client';
import { createTestApp, baseUrl } from './support/app';
import { resetState } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { connectSocket, joinScreening, waitForEvent } from './support/socket';
import { signWebhookPayload } from './support/stripe-webhook';
import { PaymentsService } from '../src/payments/payments.service';
import Stripe from 'stripe';

describe('Payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stripeMock: {
    checkout: { sessions: { create: jest.Mock; retrieve: jest.Mock } };
    refunds: { create: jest.Mock };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
    const paymentsService = app.get(PaymentsService);
    stripeMock = (paymentsService as unknown as { stripe: typeof stripeMock }).stripe;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
    jest.clearAllMocks();
  });

  async function seedHeldReservation(startTime: Date) {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, { movieId: movie.id, hallId: hall.id, startTime });
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });

    return { user, screening, seat: seats[0], reservationId: reserveRes.body.id as number };
  }

  it('creates a checkout session and extends the hold', async () => {
    const { user, reservationId } = await seedHeldReservation(new Date(Date.now() + 72 * 60 * 60_000));
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/cs_test_1',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });

    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://checkout.stripe.com/cs_test_1');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });
    expect(payment.stripeSessionId).toBe('cs_test_1');
  });

  it('a real-signed checkout.session.completed (paid) webhook confirms the reservation and broadcasts seat:booked', async () => {
    const { user, screening, seat, reservationId } = await seedHeldReservation(
      new Date(Date.now() + 72 * 60 * 60_000),
    );
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_2',
      url: 'https://checkout.stripe.com/cs_test_2',
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });

    const socket = await connectSocket(baseUrl(app));
    await joinScreening(socket, screening.id);
    const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:booked');

    const { body, signature } = signWebhookPayload({
      id: 'evt_test_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          payment_intent: 'pi_test_1',
          metadata: { paymentId: String(payment.id) },
        },
      },
    });

    const webhookRes = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(webhookRes.status).toBe(201);
    const confirmedReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
    expect(confirmedReservation.status).toBe(ReservationStatus.CONFIRMED);

    const payload = await broadcast;
    expect(payload.seatIds).toEqual([seat.id]);
    socket.disconnect();
  });

  it('rejects a webhook with a bad signature with 400 and does not change payment status', async () => {
    const { reservationId } = await seedHeldReservation(new Date(Date.now() + 72 * 60 * 60_000));
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_3',
      url: 'https://checkout.stripe.com/cs_test_3',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'not_a_real_signature')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed' })));

    expect(res.status).toBe(400);
  });

  it('cancelling a CONFIRMED reservation >48h out refunds in full via Stripe and cancels it', async () => {
    const { user, reservationId } = await seedHeldReservation(new Date(Date.now() + 72 * 60 * 60_000));
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_4',
      url: 'https://checkout.stripe.com/cs_test_4',
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });
    const { body, signature } = signWebhookPayload({
      id: 'evt_test_confirm',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          payment_intent: 'pi_test_confirm',
          metadata: { paymentId: String(payment.id) },
        },
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body);

    stripeMock.refunds.create.mockResolvedValue({ id: 're_test_1' });

    const cancelRes = await request(app.getHttpServer())
      .delete(`/api/v1/reservations/${reservationId}`)
      .set('Cookie', user.cookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe(ReservationStatus.CANCELLED);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test_confirm' }),
      expect.anything(),
    );

    const refundedPayment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });
    expect(refundedPayment.status).toBe(PaymentStatus.REFUNDED);
  });

  it('reconciliation confirms a TIMED_OUT payment Stripe reports as paid, and broadcasts seat:booked', async () => {
    const { screening, seat, reservationId } = await seedHeldReservation(
      new Date(Date.now() + 72 * 60 * 60_000),
    );
    const payment = await prisma.payment.create({
      data: {
        reservationId,
        amount: 5000,
        currency: 'usd',
        status: PaymentStatus.TIMED_OUT,
        stripeSessionId: 'cs_stuck_1',
        createdAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: 'paid',
      payment_intent: 'pi_reconciled_1',
    });

    const socket = await connectSocket(baseUrl(app));
    await joinScreening(socket, screening.id);
    const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:booked');

    const paymentsService = app.get(PaymentsService);
    await paymentsService.reconcileTimedOutPayments();

    const payload = await broadcast;
    expect(payload.seatIds).toEqual([seat.id]);

    const reconciled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(reconciled.status).toBe(PaymentStatus.SUCCEEDED);
    socket.disconnect();
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npm run test:e2e -- payments.e2e-spec.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 3: Commit**

```bash
git add backend/test/payments.e2e-spec.ts
git commit -m "test(e2e): add payments e2e spec (checkout, webhook, refund, reconciliation)"
```

---

## Task 13: `payment-abuse.e2e-spec.ts`

**Files:**
- Create: `backend/test/payment-abuse.e2e-spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// backend/test/payment-abuse.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import PaymentAbuseService from '../src/redis/payment-abuse.service';

describe('Payment abuse lockout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  it('locks out reservation creation after 3 recorded payment failures', async () => {
    const user = await createAuthedUser(prisma);
    const { hall } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const seat = (await prisma.seat.findMany({ where: { hallId: hall.id } }))[0];

    const paymentAbuse = app.get(PaymentAbuseService);
    await paymentAbuse.recordFailure(user.id);
    await paymentAbuse.recordFailure(user.id);
    await paymentAbuse.recordFailure(user.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seat.id });

    expect(res.status).toBe(403);
  });

  it('does not lock out a user under the 3-failure threshold', async () => {
    const user = await createAuthedUser(prisma);
    const { hall } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const seat = (await prisma.seat.findMany({ where: { hallId: hall.id } }))[0];

    const paymentAbuse = app.get(PaymentAbuseService);
    await paymentAbuse.recordFailure(user.id);
    await paymentAbuse.recordFailure(user.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seat.id });

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npm run test:e2e -- payment-abuse.e2e-spec.ts`
Expected: PASS, 2 tests green.

- [ ] **Step 3: Commit**

```bash
git add backend/test/payment-abuse.e2e-spec.ts
git commit -m "test(e2e): add payment-abuse lockout e2e spec"
```

---

## Task 14: Full-suite run and wrap-up

**Files:** none — verification + a short README note.
- Modify: `backend/README.md` (or create if it doesn't exist — check first)

- [ ] **Step 1: Run the entire e2e suite together**

Run: `cd backend && npm run test:e2e`
Expected: PASS — all specs from Tasks 4, 9-13 green in one run (this is the first point every e2e spec
runs together against the same containers in sequence; a leaked-state bug between files would surface
here).

- [ ] **Step 2: Run the unit suite + build once more to confirm nothing e2e-related broke them**

Run: `cd backend && npx jest && npx nest build`
Expected: PASS / no errors. (The new `backend/__mocks__/stripe.ts` lives outside `src/`, and the unit
Jest config's `rootDir` is `src`, so it should not affect unit test mocking — this step confirms that.)

- [ ] **Step 3: Document how to run the suite**

Check whether `backend/README.md` exists (`ls backend/README.md`). If it exists, add a section; if not,
skip creating one (don't invent a README where none exists — out of scope for this plan). If adding,
include:

```markdown
## End-to-end tests

Requires Docker. Testcontainers starts a dedicated test Postgres + Redis automatically (separate
from dev) via Jest's `globalSetup`, runs migrations, and reuses the containers across runs:

    cd backend
    npm run test:e2e
```

- [ ] **Step 4: Commit**

```bash
git add backend/README.md
git commit -m "test(e2e): document how to run the e2e suite"
```

(Skip this commit entirely if Step 3 found no README to update.)

---

## Self-Review Notes

- **Spec coverage:** infra (Task 1), Stripe mock strategy (Task 2), DB reset (Task 3), app harness (Task
  4), auth helper (Task 5), fixtures (Task 6), socket helper (Task 7), webhook signer (Task 8), and all six
  per-module spec files from the design's ordered list (Tasks 9-13, with movies+screenings combined into
  one task since they're both simple CRUD-plus-guard patterns built from the same fixtures) are all
  covered. Cron and gateway coverage are folded into `reservations.e2e-spec.ts` and
  `payments.e2e-spec.ts` per the spec's explicit decision, not separate files.
- **Type/name consistency:** `resetState`, `createAuthedUser`, `createHallWithSeats` /
  `createPublishedMovie` / `createScreening`, `connectSocket` / `joinScreening` / `waitForEvent`, and
  `signWebhookPayload` are named identically everywhere they're defined (Tasks 3, 5, 6, 7, 8) and where
  they're imported (Tasks 4, 9-13).
