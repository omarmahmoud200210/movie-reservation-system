# Real (non-mocked) Stripe e2e test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one opt-in e2e test that exercises the real (unmocked) Stripe API and a real
Stripe-issued webhook, relayed via the Stripe CLI, proving the checkout → webhook → reservation
confirmation path works against the real Stripe test-mode API — separate from and never run as
part of the default `test:e2e` suite.

**Architecture:** A new Jest config (`jest-e2e-stripe-live.json`) runs only
`test/stripe-live.e2e-spec.ts`, which calls `jest.unmock('stripe')` so `PaymentsService` gets the
real SDK. The test creates a real checkout session, spawns `stripe listen --forward-to
localhost:<port>/api/v1/payments/webhook` to relay real webhook deliveries to the running app,
then spawns `stripe trigger checkout.session.completed --override
checkout_session:metadata.paymentId=<id>` to produce a real, Stripe-issued, correctly-signed event
carrying that metadata (**verified empirically before writing this plan** — see Task 1).

**Tech Stack:** Stripe CLI 1.43.6 (already installed and authenticated locally), Node `child_process`
(`spawn`/`execSync`), existing Jest 30/ts-jest/Testcontainers infra from the default e2e suite.

**Verified assumption (no longer a risk):** Running `stripe listen --format JSON` and, in a
separate terminal, `stripe trigger checkout.session.completed --override
checkout_session:metadata.paymentId=999` produced a real `checkout.session.completed` event whose
`data.object.metadata` was exactly `{"paymentId":"999"}`, with `payment_status: "paid"` and a real
`payment_intent` id. The mechanism works as designed — no spike task needed in this plan.

**Prerequisite the human must do before Task 1 runs for real:** create
`backend/.env.test.stripe-live` (gitignored) containing a real Stripe test-mode secret key, e.g.:
```
STRIPE_SECRET_KEY=sk_test_...
```
`backend/.env` already has a working test-mode key for this same Stripe account
(`acct_1TqGmhFFGTr9oLHd`, confirmed via `stripe config --list`) — reusing that value is fine, or
supply a different test-mode key for the same account. The Stripe CLI is already authenticated on
this machine (`stripe config --list` shows `test_mode_api_key`), so no `stripe login` step is
needed, but every CLI invocation in this plan passes `--api-key` explicitly so the test doesn't
depend on ambient CLI login state.

---

### Task 1: `.gitignore` and jest config plumbing

**Files:**
- Modify: `.gitignore`
- Modify: `backend/test/jest-e2e.json`
- Create: `backend/test/jest-e2e-stripe-live.json`
- Modify: `backend/package.json`

- [ ] **Step 1: Ignore the new secrets file**

Current `.gitignore`:
```
node_modules/

.env

backend/test/.env.test.runtime

dist/

.worktrees/
```

Add a line:
```
node_modules/

.env

backend/test/.env.test.runtime
backend/.env.test.stripe-live

dist/

.worktrees/
```

- [ ] **Step 2: Exclude the live spec from the default e2e config**

Current `backend/test/jest-e2e.json`:
```json
{
  "rootDir": "..",
  "moduleFileExtensions": ["js", "json", "ts"],
  "testRegex": "test/.*\\.e2e-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFiles": ["<rootDir>/test/jest.setup.ts"],
  "globalSetup": "<rootDir>/test/global-setup.ts",
  "globalTeardown": "<rootDir>/test/global-teardown.ts",
  "testEnvironment": "node",
  "testTimeout": 60000
}
```

Change `testRegex` to exclude `stripe-live.e2e-spec.ts` via a negative lookahead:
```json
{
  "rootDir": "..",
  "moduleFileExtensions": ["js", "json", "ts"],
  "testRegex": "test/(?!stripe-live\\.e2e-spec).*\\.e2e-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFiles": ["<rootDir>/test/jest.setup.ts"],
  "globalSetup": "<rootDir>/test/global-setup.ts",
  "globalTeardown": "<rootDir>/test/global-teardown.ts",
  "testEnvironment": "node",
  "testTimeout": 60000
}
```

- [ ] **Step 3: Create the live-test Jest config**

Create `backend/test/jest-e2e-stripe-live.json`:
```json
{
  "rootDir": "..",
  "moduleFileExtensions": ["js", "json", "ts"],
  "testRegex": "test/stripe-live\\.e2e-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFiles": ["<rootDir>/test/jest.setup.ts", "<rootDir>/test/jest.setup.stripe-live.ts"],
  "globalSetup": "<rootDir>/test/global-setup.ts",
  "globalTeardown": "<rootDir>/test/global-teardown.ts",
  "testEnvironment": "node",
  "testTimeout": 60000
}
```

This reuses the same `globalSetup`/`globalTeardown` (Testcontainers Postgres/Redis) as the default
suite — the live test still needs a real database and Redis, just not a mocked Stripe. It reuses
`test/jest.setup.ts` (loads `.env.test` then `.env.test.runtime`) and layers on a second setup file
(Task 2) that overrides the Stripe key.

- [ ] **Step 4: Add the npm script**

In `backend/package.json`, find:
```json
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
```

Add immediately after:
```json
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
    "test:e2e:stripe-live": "jest --config ./test/jest-e2e-stripe-live.json --runInBand",
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore backend/test/jest-e2e.json backend/test/jest-e2e-stripe-live.json backend/package.json
git commit -m "chore(test): add jest config and script for live-stripe e2e test"
```

---

### Task 2: Load the real Stripe key for the live suite

**Files:**
- Create: `backend/test/jest.setup.stripe-live.ts`

This is a second `setupFiles` entry (runs after `jest.setup.ts` per Task 1 Step 3's ordering),
overriding `STRIPE_SECRET_KEY` with the real key from `backend/.env.test.stripe-live`. It must
fail loudly and specifically if that file is missing, rather than letting the test fail later with
a confusing Stripe API error.

- [ ] **Step 1: Write `backend/test/jest.setup.stripe-live.ts`**

```typescript
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const STRIPE_LIVE_ENV_PATH = path.resolve(__dirname, '../.env.test.stripe-live');

if (!fs.existsSync(STRIPE_LIVE_ENV_PATH)) {
  throw new Error(
    `Missing ${STRIPE_LIVE_ENV_PATH}. This file must contain a real Stripe test-mode secret key ` +
      `(STRIPE_SECRET_KEY=sk_test_...) to run test:e2e:stripe-live. See ` +
      `docs/superpowers/plans/2026-07-15-stripe-live-testing.md for setup.`,
  );
}

dotenv.config({ path: STRIPE_LIVE_ENV_PATH, override: true });

if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error(
    `${STRIPE_LIVE_ENV_PATH} must set STRIPE_SECRET_KEY to a real Stripe test-mode secret key ` +
      `(starting with sk_test_), got: ${process.env.STRIPE_SECRET_KEY ?? '(unset)'}`,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add test/jest.setup.stripe-live.ts
git commit -m "feat(test): load real Stripe test-mode key for live e2e suite"
```

---

### Task 3: Stripe CLI helper

**Files:**
- Create: `backend/test/support/stripe-cli.ts`

Wraps `stripe listen` (long-running child process, relays webhooks) and `stripe trigger`
(one-shot, fires an event). Both always receive `--api-key` explicitly so the test never depends
on ambient `stripe login` state.

- [ ] **Step 1: Write `backend/test/support/stripe-cli.ts`**

```typescript
import { spawn, execFileSync } from 'child_process';

const READY_LINE = /Ready! You are using Stripe API Version .* Your webhook signing secret is (whsec_\w+)/;

export interface WebhookRelay {
  webhookSecret: string;
  stop: () => void;
}

/** Spawns `stripe listen`, forwarding real webhook deliveries to the given local URL. Resolves
 * once the CLI reports it's ready and reveals the per-session signing secret it printed —
 * that secret (not any dashboard secret) is what `stripe.webhooks.constructEvent` must verify
 * against for events relayed by this process. */
export function startWebhookRelay(
  forwardToUrl: string,
  apiKey: string,
  timeoutMs = 20_000,
): Promise<WebhookRelay> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'stripe',
      ['listen', '--forward-to', forwardToUrl, '--api-key', apiKey, '--skip-update'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`stripe listen did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const match = buffer.match(READY_LINE);
      if (match) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        resolve({
          webhookSecret: match[1],
          stop: () => child.kill(),
        });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Fires a real `checkout.session.completed` event via `stripe trigger`, overriding the
 * session's metadata.paymentId so it correlates to the payment the test created. This creates
 * real fixture objects (product/price/session) on the Stripe test account — verified empirically
 * that `--override checkout_session:metadata.paymentId=<id>` threads through to the relayed
 * event's data.object.metadata. */
export function triggerCheckoutCompleted(paymentId: number, apiKey: string): void {
  execFileSync(
    'stripe',
    [
      'trigger',
      'checkout.session.completed',
      '--override',
      `checkout_session:metadata.paymentId=${paymentId}`,
      '--api-key',
      apiKey,
      '--skip-update',
    ],
    { stdio: 'inherit' },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add test/support/stripe-cli.ts
git commit -m "feat(test): add stripe CLI listen/trigger helper for live e2e test"
```

---

### Task 4: The live e2e spec

**Files:**
- Create: `backend/test/stripe-live.e2e-spec.ts`

Mirrors the structure of `test/payments.e2e-spec.ts`'s webhook test (same fixtures, same
assertions), but through the real path. Read `test/payments.e2e-spec.ts` and
`test/support/{app,db,auth,fixtures,socket,prisma}.ts` first — this file reuses all of those
verbatim except it does not use the Stripe mock.

- [ ] **Step 1: Write `backend/test/stripe-live.e2e-spec.ts`**

```typescript
// backend/test/stripe-live.e2e-spec.ts
//
// Opt-in test against the REAL Stripe test-mode API — not run by `npm run test:e2e`.
// Run with `npm run test:e2e:stripe-live`. Requires:
//   - the Stripe CLI installed and on PATH (confirmed present: 1.43.x)
//   - backend/.env.test.stripe-live with a real STRIPE_SECRET_KEY=sk_test_...
// See docs/superpowers/plans/2026-07-15-stripe-live-testing.md for the full design.

jest.unmock('stripe');

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, ReservationStatus } from '@prisma/client';
import { createTestApp, baseUrl } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { connectSocket, joinScreening, waitForEvent } from './support/socket';
import { createTestPrismaClient } from './support/prisma';
import { startWebhookRelay, triggerCheckoutCompleted, WebhookRelay } from './support/stripe-cli';

describe('Payments (live Stripe e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let relay: WebhookRelay;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrismaClient();

    const apiKey = process.env.STRIPE_SECRET_KEY as string;
    relay = await startWebhookRelay(`${baseUrl(app)}/api/v1/payments/webhook`, apiKey);
    process.env.STRIPE_WEBHOOK_SECRET = relay.webhookSecret;
  });

  afterAll(async () => {
    relay.stop();
    await closeRedis();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  it('a real checkout session, completed via a real Stripe-relayed webhook, confirms the reservation and broadcasts seat:booked', async () => {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 72 * 60 * 60_000),
    });
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });
    const reservationId = reserveRes.body.id as number;

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });
    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });

    const socket = await connectSocket(baseUrl(app));
    try {
      await joinScreening(socket, screening.id);
      const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:booked', 30_000);

      triggerCheckoutCompleted(payment.id, process.env.STRIPE_SECRET_KEY as string);

      const payload = await broadcast;
      expect(payload.seatIds).toEqual([seats[0].id]);

      const confirmedReservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
      });
      expect(confirmedReservation.status).toBe(ReservationStatus.CONFIRMED);
    } finally {
      socket.disconnect();
    }
  }, 45_000);
});
```

Note the test doesn't assert on the webhook HTTP response directly (unlike the mocked test) —
`stripe listen` relays the event asynchronously and doesn't expose the app's response back to the
test process, so the reservation-confirmed + broadcast assertions are the observable proof the
webhook was received and processed correctly.

- [ ] **Step 2: Commit**

```bash
git add test/stripe-live.e2e-spec.ts
git commit -m "feat(test): add live (non-mocked) Stripe e2e test"
```

---

### Task 5: Run it for real and verify

**Files:** none (verification task)

- [ ] **Step 1: Confirm the setup guard fires without the key file**

Run: `cd backend && rm -f .env.test.stripe-live && npm run test:e2e:stripe-live`
Expected: fails fast with the `Missing .../.env.test.stripe-live` error from Task 2, not a
confusing Stripe API error.

- [ ] **Step 2: Add the real key and run for real**

Create `backend/.env.test.stripe-live`:
```
STRIPE_SECRET_KEY=sk_test_...
```
(reuse the value already in `backend/.env`'s `STRIPE_SECRET_KEY`, or supply your own test-mode key
for the same account).

Run: `cd backend && npm run test:e2e:stripe-live`

Expected: `stripe listen` starts, the trigger fires, the test passes — 1 suite, 1 test, both
green. This will print CLI update-check chatter and `Ready!`/`Trigger succeeded!` lines to the
console; that's expected, not a failure.

- [ ] **Step 3: Confirm the default suite is unaffected**

Run: `cd backend && npm run test:e2e`

Expected: still 7 suites / 24 tests, all passing, `stripe-live.e2e-spec.ts` not among them (confirm
by checking the suite list in the output doesn't mention `stripe-live`).

- [ ] **Step 4: Confirm the live test file is genuinely excluded from tsc/lint gates that scan test/**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors — `stripe-live.e2e-spec.ts` and `support/stripe-cli.ts` type-check cleanly
regardless of which jest config picks them up (tsc isn't jest-config-aware, so this just confirms
the new files themselves are valid TypeScript).
