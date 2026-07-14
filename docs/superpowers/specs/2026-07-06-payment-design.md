# Payment — Design

**Date:** 2026-07-06
**Build order:** Phase 9. Unblocked by Rate Limiting (✅, `2026-07-05-rate-limiting-design.md`).
**Depends on:** Reservations (✅ — `reserve()`/`cancel()` both already carry `DEFERRED(phase-9)` markers),
`stripe` SDK (✅ already a dependency, `^22.2.2`), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/
`FRONTEND_URL` (✅ already in `.env`), `rawBody: true` (✅ already set in `main.ts`, needed for webhook
signature verification), `RedisModule` (✅ `@Global()`, gains one more provider this phase).

## Goal

Implement `architecture.md` §8 end to end: Stripe Checkout for paying for a HELD reservation, a webhook
that confirms/declines it, refunds on cancellation of a CONFIRMED booking, a reconciliation cron for
stuck `timed_out` payments, and a new payment-abuse lockout that pauses a user's ability to make new
reservations after repeated payment failures. Resolves the `DEFERRED(phase-9)` markers in
`reservations.service.ts` (`cancel()`) and `reservation-broadcast.listener.ts` (HELD→CONFIRMED
broadcast), and the payment-reconciliation placeholder comment in `hold-expiry.cron.ts`.

## Reservations are single-seat (companion change, out of `PaymentsModule` proper)

Booking is one seat per `reserve()` call — no seat-selection multi-pick. `reserve()` today accepts
`seatIds: number[]` (built in an earlier phase); this phase changes that to a single `seatId: number`
before payments are wired on top, so `Payment` stays a plain 1:1 with `Reservation` (see schema changes
below) and there is no "booking group" concept anywhere in the payment flow. A user who wants a second
seat calls `reserve()` again and pays for it as a separate `Payment`.

Touches, in `backend/src/reservations/`:
- `dto/create-reservation.dto.ts`: `seatIds: number[]` (`@IsArray`/`@ArrayNotEmpty`) → `seatId: number`
  (`@IsInt`/`@Min(1)`).
- `reservations.service.ts` `reserve()`: drop the `[...new Set(dto.seatIds)]` dedup and the "hold one or
  more seats, all-or-nothing" framing; hold exactly one seat, return one `Reservation`.
- `reservations.repository.ts` `holdSeats()`: takes one `seatId`, returns one `Reservation` (rename to
  `holdSeat` if it reads better — implementer's call).
- Existing specs referencing `seatIds` arrays (`reservations.controller.spec.ts`,
  `reservations.repository.spec.ts`, `reservations.service.spec.ts`, `reservation-cache.listener.spec.ts`)
  need updating for the new single-seat shape.

`ReservationStatus` (`HELD`/`CONFIRMED`/`CANCELLED`) is untouched by this phase — no new value added.

## Schema changes required (this phase)

Two changes to `schema.prisma`:

**1. `PaymentStatus` enum — expand to match the documented flow.**
Currently `PENDING, SUCCESS, FAILED, REFUNDED` (4 values, nothing in `src/` depends on these values
today — verified by grep, so this is a free rename). New: `PENDING, IN_PROGRESS, SUCCEEDED, DECLINED,
TIMED_OUT, FAILED, REFUNDED` (7 values), matching the flow diagram in `architecture.md` §8 with
`REFUNDED` kept as its own terminal state (reached from `SUCCEEDED` via the cancellation flow) rather
than collapsed into `SUCCEEDED`.

`Payment` ↔ `Reservation` stays 1:1 as it already is (`Payment.reservationId` `@unique`) — no relation
change, since a `reserve()` call now only ever produces one `Reservation` to pay for.

**2. `Screening.price` unit — document it, no schema change.**
`price` is a bare `Int` with no unit comment, and existing test fixtures use values like `10`, `20`,
`50`, `80` — round numbers consistent with whole currency units, not cents. `Payment.amount` (per
`architecture.md`, "in cents/piastres, NEVER floats") is therefore **derived**, not stored raw: `amount =
screening.price * 100`. Stated explicitly here so it isn't left as an implicit assumption in the
implementation.

**Currency is a fixed constant, currently `'usd'`** — no `PAYMENT_CURRENCY` env var, no per-user/locale
selection. `currency: 'usd'` lives as a single constant in `PaymentsService`, not configuration, since
there is exactly one value it will ever take at a time. Set to USD for now during testing (avoids
depending on confirming EGP support on the Stripe test account first) — flip the one constant to `'egp'`
once that's verified, no other code changes needed.

## Why the `heldUntil` extension (not a new `ReservationStatus`)

Stripe Checkout Sessions have a minimum `expires_at` of **30 minutes** from creation — you cannot make a
session expire sooner. The existing hold window (`HOLD_MINUTES = 10` in `reservations.service.ts`) is
shorter than that. Left unreconciled, a user who starts checkout at minute 9 of their hold has a Stripe
session that's still open at minute 30, while `HoldExpiryCron` sweeps their `HELD` reservation as expired
at minute 10 — the seat gets released (and can be re-sold) while a real payment is still in flight
against it.

**Fix:** creating a checkout session extends the reservation's `heldUntil` to match the session's
`expires_at` (fixed at *now + 30 min*, Stripe's minimum), instead of introducing a new
`ReservationStatus` (e.g. `PENDING_PAYMENT`) to shield the row from the cron. The reservation stays
`HELD` throughout — the cron's existing `WHERE status = 'HELD' AND heldUntil < now` logic keeps working
unmodified; it just doesn't fire until the (now later) `heldUntil` actually passes. If the session
expires or the payment fails, the row is simply `HELD` with a `heldUntil` in the past by the time the
cron's next tick runs — no special-casing needed there either.

## Scope

**In:**
- Single-seat `reserve()` (companion change above).
- `PaymentsModule`: checkout session creation, webhook handling, refund-on-cancel, reconciliation cron.
- The schema change above (`PaymentStatus` enum expansion).
- Payment-abuse lockout: 3 `DECLINED`/`FAILED` payments in a rolling 24h window → blocks **new**
  reservation creation (not checkout) for 30 min. Redis-backed (`payment_failures:user:{id}` sorted set,
  `payment_lockout:user:{id}` TTL key), living in the already-`@Global()` `RedisModule` alongside
  `RateLimiterService` — not a variant of it (see `architecture.md` §8's "why not reuse
  `RateLimiterService`" note).
- Extending `ReservationsService.cancel()` to refund a `CONFIRMED` reservation (currently only cancels
  `HELD` rows — the `DEFERRED(phase-9)` marker there).
- Extending `ReservationBroadcastListener` to handle a new `RESERVATION_CONFIRMED` event with a
  `seat:booked` broadcast (the `DEFERRED(phase-9)` marker there).
- Extending `HoldExpiryCron` with the reconciliation job (the placeholder comment there).

**Out:**
- Multi-currency — `currency` is a fixed constant (`'usd'` for now), not configuration.
- Multi-seat checkout / partial-seat cancellation — moot now that `reserve()` is single-seat; each
  `Payment` covers exactly one `Reservation`.
- Recording the *actual* refunded amount for a partial refund as its own column — `Payment` already has
  `refundId`/`refundedAt`; the Stripe refund object (fetchable via `refundId`) is the source of truth for
  the amount if it's ever needed for an audit, so no new column is added speculatively.
- Async payment methods' full state machine (bank transfers etc. that go through Stripe's
  `IN_PROGRESS`-then-later-resolved path in earnest) — `IN_PROGRESS` is modeled in the enum per the doc,
  but this phase only wires the card-payment (synchronous) path through webhooks. Revisit if a non-card
  payment method is ever enabled in Stripe's dashboard.

## Components

```
backend/src/payments/
├── payments.module.ts
├── payments.controller.ts        # POST checkout-session, POST webhook, GET status
├── payments.service.ts           # checkout session creation, webhook handling, refund, reconciliation
├── payments.repository.ts        # Prisma access for Payment rows
├── dto/
│   └── create-checkout-session.dto.ts
└── test/
    ├── payments.service.spec.ts
    ├── payments.controller.spec.ts
    └── payments.repository.spec.ts

backend/src/common/services/
├── payment-abuse.service.ts      # lockout counter + check (Redis-backed, lives in RedisModule)
└── test/payment-abuse.service.spec.ts
```

`PaymentsModule` imports `ReservationsModule` (for `ReservationsService` — no new export of
`ReservationsRepository` needed, the service already has everything payments needs to call: hold lookup,
extend, confirm). `ReservationsModule` does **not** import `PaymentsModule` back — the one place
`ReservationsService.reserve()` needs payment-abuse state, it goes through `PaymentAbuseService` (global,
from `RedisModule`), not through `PaymentsService` directly. No circular module dependency.

### `PaymentsController`

| Route | Auth | Purpose |
|---|---|---|
| `POST /payments/checkout-session` | `JwtAuthGuard` (+ `RateLimitGuard`, reuse the existing per-user layer — no rule for this route in `architecture.md` today, so add one: 5/1min, key `payments:checkout`, to stop repeated session-creation spam distinct from the failed-payment lockout) | Body: `{ reservationId: number }`. Validates ownership + `HELD` + not already linked to a `Payment`, computes amount, creates the Stripe Checkout Session, creates the `Payment` row, extends `heldUntil`, returns `{ url }` for redirect. |
| `POST /payments/webhook` | none (Stripe signature verification *is* the auth) | Raw body (already enabled globally via `rawBody: true`). Verifies signature, checks `stripeEventId` idempotency, dispatches on event type. |
| `GET /payments/reservations/:reservationId/status` | `JwtAuthGuard` | Polled by the frontend's confirmation-spinner page. Returns `{ reservationStatus, paymentStatus }`. Lives under `/payments` (not `/reservations`, despite `architecture.md`'s illustrative `GET /reservations/:id/status`) specifically to avoid the reverse module import — see "Companion changes" below. |

### `PaymentsService` — checkout session creation

1. Look up the reservation by id + `userId` (ownership) via `ReservationsService`; 404 if missing or not
   owned (same not-found-not-forbidden convention `cancel()` already uses).
2. Reject (409) if it isn't `HELD` or a `Payment` row already exists for it (`Payment.reservationId` is
   `@unique`, so this is a `PaymentsRepository.findByReservationId(id)` lookup, not a field on
   `Reservation` — the FK lives on `Payment`, unchanged from the schema as it exists today).
3. `amount = screening.price * 100`, `currency = 'usd'`.
4. Create the `Payment` row (`status: PENDING`, `reservationId`) in one transaction (mirrors the
   transactional style already in `reservations.repository.ts`).
5. Call `stripe.checkout.sessions.create({ mode: 'payment', line_items: [...], success_url:
   '{FRONTEND_URL}/reservations/success?session_id={CHECKOUT_SESSION_ID}', cancel_url:
   '{FRONTEND_URL}/reservations', expires_at: <now + 30min, unix seconds>, metadata: { paymentId:
   payment.id } })`.
6. Store `stripeSessionId` on the `Payment` row.
7. Extend the reservation's `heldUntil` to the same *now + 30min* timestamp used as `expires_at`
   (see "Why the `heldUntil` extension" above) — needs a new `ReservationsRepository`/`Service` method,
   e.g. `extendHold(reservationId, until)`.
8. Return `{ url: session.url }`.

### `PaymentsService` — webhook handling

Verify via `stripe.webhooks.constructEvent(req.rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)`.
Look up `event.id` against `Payment.stripeEventId`; if already processed, return 200 immediately
(idempotency — Stripe retries webhooks on anything other than a 2xx).

| Stripe event | `Payment.status` → | Reservation effect | Abuse counter |
|---|---|---|---|
| `checkout.session.completed` (`payment_status: 'paid'`) | `SUCCEEDED` | Reservation `HELD → CONFIRMED`, `heldUntil` cleared. Emits `RESERVATION_CONFIRMED`. | — |
| `checkout.session.completed` (`payment_status: 'unpaid'`, async method) | `IN_PROGRESS` | Unchanged (still `HELD`, hold already extended) | — |
| `checkout.session.async_payment_failed` | `FAILED` | Unchanged (`HELD`, retriable until `heldUntil`) | `PaymentAbuseService.recordFailure(userId)` |
| `checkout.session.expired` | `TIMED_OUT` | Unchanged — `heldUntil` is already ≈ now, next cron tick sweeps it normally | — |
| `charge.dispute.created` | `disputed = true`, `disputeReason`, `disputedAt` set (status unchanged) | Unchanged | — |
| card decline surfaced synchronously (checkout session never completes; no further Stripe event beyond the session's own expiry) | handled via `checkout.session.expired` → `TIMED_OUT`, then reconciliation cron confirms via Stripe API and sets `DECLINED` | Unchanged | `PaymentAbuseService.recordFailure(userId)` on the reconciliation-cron path once confirmed `DECLINED` |

### `PaymentsService` — refund on cancellation

`ReservationsService.cancel()` currently only allows cancelling `HELD` rows (throws 409 otherwise) — the
`DEFERRED(phase-9)` marker. New behavior for a `CONFIRMED` reservation:

1. Look up the applicable `RefundPolicy` row by hours until `screening.startTime` (the `[hoursFrom,
   hoursTo)` range containing that value) → `refundPercent`.
2. `refundAmount = payment.amount * refundPercent / 100`.
3. `stripe.refunds.create({ payment_intent: <from the Payment/Stripe session>, amount: refundAmount })`
   (skip the Stripe call entirely if `refundPercent === 0` — no refund to issue, just cancel).
4. DB transaction: reservation `→ CANCELLED`, `Payment.status → REFUNDED`, `refundId`/`refundedAt` set.
5. Emit `RESERVATION_CANCELLED` per the existing event shape (drives the existing cache-invalidation +
   WebSocket listeners for free, same as today).

This lives in `PaymentsService` (it owns `Payment`/Stripe concerns), called from
`ReservationsService.cancel()` when the looked-up reservation's status is `CONFIRMED` rather than `HELD`.

### `PaymentAbuseService` (in `RedisModule`)

```ts
@Injectable()
export class PaymentAbuseService {
  constructor(private readonly redis: RedisCache) {}

  async recordFailure(userId: number): Promise<void> {
    const key = `payment_failures:user:${userId}`;
    const now = Date.now();
    const client = this.redis.getClient();
    await client.zadd(key, now, `${now}-${randomUUID()}`);
    await client.zremrangebyscore(key, 0, now - 24 * 60 * 60_000);
    const count = await client.zcard(key);
    if (count >= 3) {
      await client.set(`payment_lockout:user:${userId}`, '1', 'PX', 30 * 60_000);
    }
  }

  async isLockedOut(userId: number): Promise<boolean> {
    const client = this.redis.getClient();
    return (await client.exists(`payment_lockout:user:${userId}`)) === 1;
  }
}
```
Plain `ioredis` calls (not the Lua-script pattern `RateLimiterService` uses) — there's no concurrent
read-then-write race to close here the way there was for the rate limiter: this only *sets* a lockout
once a threshold is crossed and *reads* a single key to check it, no admit/reject decision under
contention. `ReservationsService.reserve()` calls `isLockedOut(userId)` first and throws
`ForbiddenException` if locked out, before any of its existing logic runs.

### Reconciliation cron (`HoldExpiryCron`, resolves its placeholder comment)

```
Every 5 min → find Payment where status = 'TIMED_OUT' AND createdAt < NOW() - 10min
→ stripe.checkout.sessions.retrieve(stripeSessionId) for each
→ payment_status 'paid'  → SUCCEEDED, confirm reservations (same path as the webhook's success branch)
→ otherwise              → DECLINED, record abuse failure, reservations stay HELD (cron sweeps normally)
```

## Error handling

| Case | Status | Notes |
|---|---|---|
| Checkout session requested for a reservation not owned by caller | 404 | Same not-found-not-forbidden convention as `cancel()` |
| Checkout session requested for a non-`HELD` or already-paid reservation | 409 | — |
| User is payment-locked-out, calls `POST /reservations` | 403 | `ForbiddenException`, checked before any hold logic runs |
| Webhook signature invalid | 400 | Stripe's `constructEvent` throws; caught and returned as 400, no DB writes |
| Webhook event already processed (`stripeEventId` seen) | 200 | No-op, required for Stripe's retry semantics |
| Cancelling a `CONFIRMED` reservation outside any refund window (`refundPercent = 0`) | 200 | Cancellation still succeeds; no Stripe refund call made |

## Testing (TDD)

- **`PaymentsService.createCheckoutSession`**: ownership/404, not-`HELD`/409, already-paid/409, amount
  calculation (`price * 100`), Stripe SDK call args, `heldUntil` extension call, `Payment` row shape.
- **`PaymentsService.handleWebhookEvent`**: signature failure → 400 no DB write; duplicate
  `stripeEventId` → no-op; each event-type branch → correct `Payment.status` + reservation effect +
  `RESERVATION_CONFIRMED` emission (success path only) — mock the Stripe SDK, never call it for real.
- **`PaymentsService.refundReservation`**: refund-percent lookup by hours-until-screening (each of the
  three default ranges), `refundPercent: 0` skips the Stripe call, `Payment.status → REFUNDED`.
- **`PaymentAbuseService`**: `recordFailure` under 3 → no lockout key set; 3rd failure within the 24h
  window → lockout key set with the 30min TTL; failures older than 24h don't count toward the threshold;
  `isLockedOut` reflects key presence.
- **`ReservationsService.reserve()`**: single-seat DTO round-trip; locked-out user → `ForbiddenException`,
  no hold attempted; `PaymentAbuseService.isLockedOut` called before `ReservationsRepository.holdSeat`.
- **`ReservationsService.cancel()`**: `CONFIRMED` reservation now routes into the refund path instead of
  throwing 409 (replaces the existing "only HELD can be cancelled" test's coverage of that branch).
- **`ReservationBroadcastListener`**: new `RESERVATION_CONFIRMED` → `seat:booked` broadcast with
  `SeatStatus.BOOKED`, mirroring the existing two branches' test shape.
- **`HoldExpiryCron` reconciliation**: `TIMED_OUT` + old enough → Stripe status checked; `paid` →
  `SUCCEEDED` + confirm; anything else → `DECLINED` + abuse failure recorded.
- **Prisma migration**: round-trip the enum expansion against a throwaway DB (apply, verify the 7-value
  enum exists, no data loss — table is empty pre-phase-9 so no real backfill risk).

## Companion changes to `architecture.md`

- §8 status enum / `payments` table / refund-policy table already updated (this session, prior to this
  spec) to the 7-value enum, `refunded` terminal state, and `hours_from`/`hours_to` ranges.
- §8's illustrative `GET /reservations/:id/status` should be corrected to `GET
  /payments/reservations/:id/status` once this phase ships, with a one-line note on why (avoids
  `PaymentsModule` ↔ `ReservationsModule` circular import).
- The Payment Abuse Lockout subsection (already added this session) stays as-is — matches this spec's
  `PaymentAbuseService` design exactly.
- Any illustrative multi-seat / `seatIds[]` language in §8 or the reservations section should be
  corrected to single-seat, matching the companion change above.

## Follow-ups noted for later phases

- **Multi-seat booking**: paying for several seats in one Stripe Checkout Session — would require
  reintroducing seat selection in `reserve()` and a `Payment` 1:many relation; explicitly out for now
  per this session's direction.
- **Multi-currency**: the currency constant is hardcoded (`'usd'` for now, `'egp'` once verified); per-locale currency is a real feature if this app ever serves
  multiple regions, not built now.
- **Refunded-amount auditing**: if a dispute or support case ever needs the exact historical refunded
  amount without calling Stripe, add a `refundedAmount` column then — not speculatively now.
- **Async payment methods**: `IN_PROGRESS` is modeled in the enum but its full multi-event lifecycle
  (`async_payment_succeeded` after a delay) is only exercised if a non-card Stripe payment method is ever
  enabled.
- **Reconciliation cadence**: every 5 min / 10 min grace period are the doc's original numbers, carried
  forward unchanged — revisit under real traffic if `timed_out` payments pile up faster than the cron
  drains them.
