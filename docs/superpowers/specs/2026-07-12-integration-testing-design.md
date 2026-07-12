# Integration/E2E Testing Design

**Goal:** Stand up one end-to-end test suite — real NestJS app, real Postgres, real Redis, Stripe SDK
mocked — that exercises every existing module's HTTP surface, the WebSocket gateway, and the two cron
jobs. Organized so each module gets its own spec file and the suite grows incrementally, the same way
unit tests are organized per module today.

**Why now:** The payments module (Phase 9) is the newest and riskiest code in the system — webhook
signature verification, a `forwardRef()` circular dependency between `PaymentsService` and
`ReservationsService`, event-driven cache/broadcast invalidation, and a cron reconciliation job. Task 15
of the payments plan is a manual smoke test today; this suite automates that flow and extends the same
approach to every other module, so future changes get caught by a test run instead of a human walking
through Postman/curl.

**Out of scope:** GitLab CI wiring. This suite needs to exist and pass locally first; hooking it into a
pipeline is a natural next step but its own separate plan.

---

## Infrastructure

**`backend/docker-compose.test.yml`** (new file) — Postgres + a single Redis container (cache only; the
codebase's `RedisPubSub` was dropped from `RedisModule` since nothing consumes it yet). Different host
ports from the dev `docker-compose.yml` so both can run side by side without conflict.

**`backend/.env.test`** (new file) — `DATABASE_URL` pointed at the test Postgres container,
`REDIS_CACHE_HOST`/`PORT` at the test Redis container, a fixed `STRIPE_WEBHOOK_SECRET` (e.g.
`whsec_test_fixed_secret_for_e2e`) used to sign test webhook payloads. No real `STRIPE_SECRET_KEY` is
needed — the Stripe SDK is mocked (see below), so this can be any placeholder value.

**`backend/test/jest-e2e.json`** — referenced by the existing `"test:e2e"` npm script but the file (and
the whole `test/` directory) doesn't exist yet. Standard Nest e2e Jest config: `rootDir: '..'`, `testEnvironment: 'node'`, `testRegex: '.e2e-spec.ts$'`, loads `backend/.env.test` before the suite via a
`setupFiles` entry.

**Running locally:**
```bash
cd backend
docker compose -f docker-compose.test.yml up -d
npx prisma migrate deploy   # against .env.test's DATABASE_URL
npm run test:e2e
docker compose -f docker-compose.test.yml down
```

---

## Shared Test Harness (`backend/test/support/`)

All per-module spec files import from here — no duplicated bootstrapping logic per file.

- **`app.ts`** — `createTestApp()`: builds a real `INestApplication` from the real `AppModule` via
  `Test.createTestingModule({ imports: [AppModule] })`, with `jest.mock('stripe')` active at the file
  level (same mock shape the unit tests already use: `checkout.sessions.{create,retrieve}`,
  `refunds.create`, `webhooks.constructEvent`/`generateTestHeaderString`). Everything else — Prisma,
  Redis, `EventEmitter2`, guards, the real HTTP pipeline — runs unmodified. Returns the app plus a
  Supertest-ready `request(app.getHttpServer())` helper.

- **`db.ts`** — `resetDb(prisma: PrismaService)`: truncates every application table (`TRUNCATE ... RESTART
  IDENTITY CASCADE` via `$executeRawUnsafe`, table list read from `information_schema` so it doesn't need
  manual upkeep as models are added) in a `beforeEach`, then calls the existing `prisma/seed.ts` logic (or
  re-inserts the same three `RefundPolicy` rows directly) since that's the one table tests need
  pre-populated rather than empty.

- **`auth.ts`** — `createAuthedUser(prisma, overrides?)`: inserts a `User` row directly (verified,
  `role: 'USER'` by default, override for `'ADMIN'`), signs a real access token via the app's actual
  `TokenService.signAccessToken` (not a hand-rolled JWT), returns `{ user, accessToken }`. Tests attach
  `Authorization: Bearer ${accessToken}` — this exercises the real `JwtAuthGuard`/`JwtStrategy` on every
  request, just skips the OTP/email round-trip to get there.

- **`socket.ts`** — `connectToScreening(port, screeningId)`: wraps `socket.io-client`, joins the
  screening's room the same way the real frontend would, returns a small `waitForEvent(eventName)`
  promise helper with a timeout, and a `disconnect()` for teardown.

- **`stripe-webhook.ts`** — `signWebhookPayload(payload, secret)`: uses the mocked Stripe module's
  `webhooks.generateTestHeaderString` (or, since Stripe's own is what's mocked, a small helper that
  replicates its real signing scheme against the fixed `.env.test` secret) so `handleWebhookEvent`'s
  signature-verification branch is exercised for real, not stubbed out.

---

## Per-Module Spec Files

One file per module under `backend/test/`, built in this order (each depends on the previous existing):

1. **`auth.e2e-spec.ts`** — login with a seeded user, refresh-token rotation, and a guard-rejection case
   (missing/expired/tampered token → 401). Registration/OTP already has full unit coverage; e2e's job here
   is proving the real guard/strategy wiring, not re-testing OTP logic.

2. **`movies.e2e-spec.ts`**, **`screenings.e2e-spec.ts`** — CRUD through the real HTTP pipeline, admin-only
   endpoints rejecting a non-admin token with 403.

3. **`reservations.e2e-spec.ts`** — reserve a seat (real `HELD` row + real DB lock), attempt a duplicate
   reserve on the same seat (409), cancel a `HELD` reservation, and a hold-expiry path: create a hold,
   directly invoke `HoldExpiryCron.handleExpireHolds()` after manipulating `heldUntil` into the past,
   assert the reservation is released and a `seat:cancelled` broadcast arrives via the socket helper.

4. **`payments.e2e-spec.ts`** — the full payments lifecycle:
   - reserve → `POST /payments/checkout-session` → `Payment` row created, `heldUntil` extended
   - `checkout.session.completed` (paid) webhook, properly signed → reservation `CONFIRMED`, `seat:booked`
     broadcast asserted
   - `checkout.session.completed` (unpaid/async) → `IN_PROGRESS`, no reservation change
   - `checkout.session.async_payment_failed` → `FAILED`, payment-abuse failure recorded
   - `checkout.session.expired` → `TIMED_OUT`
   - `charge.dispute.created` → disputed fields set
   - cancel a `CONFIRMED` reservation → refund path (percentage from `RefundPolicy` based on a
     screening's `startTime` fixture), reservation `CANCELLED`
   - reconciliation: create a `TIMED_OUT` payment past the grace period, directly invoke
     `PaymentsService.reconcileTimedOutPayments()`, assert both the paid-confirms and
     declined-cancels branches (transactional repo methods) and their `RESERVATION_CONFIRMED`/
     `RESERVATION_CANCELLED` event emissions (via socket broadcast assertions)

5. **`payment-abuse.e2e-spec.ts`** — 3 recorded failures for a user (via the real `PaymentAbuseService`
   against the real test Redis) → 4th `POST /reservations` attempt returns a real 403, independent of
   which payment-service code path recorded the failures.

**Cron and gateway coverage is folded into the module specs that exercise them** (reservations for
hold-expiry, payments for reconciliation) rather than separate files — they're not independent surfaces,
they're triggered by and observed through the same module's behavior.

---

## Testing the Testing: What This Suite Does and Doesn't Replace

- **Doesn't replace unit tests.** Unit tests stay the primary tool for branch coverage (e.g., all 7
  webhook-type branches, refund-percent math, lockout threshold edge cases) — e2e tests cover 1-2
  representative cases per flow, not every branch, to keep runtime and maintenance reasonable.
- **Replaces Task 15's manual walkthrough** for the payments plan specifically — once `payments.e2e-spec.ts`
  exists and passes, the plan's Task 15 can be marked satisfied by "the e2e suite covers this" rather than
  a human clicking through Stripe Checkout.
- **Does not test the real Stripe integration** (a live Checkout Session page, a real webhook from
  Stripe's servers). That gap is inherent to mocking the SDK — an occasional manual pass with the Stripe
  CLI against a real test-mode account (what Task 15 already describes) remains the only way to catch a
  Stripe-side API contract change.
