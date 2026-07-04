# Cron Jobs — Design

**Date:** 2026-07-04
**Build order:** Phase 6 (`architecture.md` line 522)
**Depends on:** Reservations (HTTP), WebSocket Gateway (both ✅)

## Goal

Release seats whose 10-minute hold expired without confirmation, so they
become bookable again — and make that release show up live for anyone
watching the screening, by reusing the existing reservation event pipeline
rather than building a new one.

## Scope

**In:**
- `expireHolds` (every 1 min): find `HELD` reservations whose `heldUntil` has
  passed, release them, and emit the existing `reservation.cancelled` event so
  the already-built cache-invalidation and WebSocket-broadcast listeners pick
  it up for free.
- A thin `CronModule` (`src/cron/`) that only schedules the trigger; the
  actual logic lives in `ReservationsService`, which already owns reservation
  lifecycle rules and the event emitter.

**Out (with reasoning, not just "later"):**
- **`completeScreenings`** — cut entirely from this phase. Verified by
  grepping every `ScreenStatus` consumer in the codebase: the "now showing"
  query, the reservation-creation guard, and every screening lookup already
  independently gate on `startTime` comparisons, not on a `COMPLETED` status.
  No code reads `ScreenStatus.COMPLETED` today. Building it now would be
  shipping a status transition with no reader — revisit when a real consumer
  appears (admin screening list, reviews/ratings, analytics, or phase-9
  payment reconciliation).
- **Payment reconciliation cron** — needs the Payments module (phase 9).
  `DEFERRED(phase-9)` marker in `CronModule`.
- **Distributed/cross-instance locking** — not needed. `expireHolds`' query is
  idempotent (`WHERE status = 'HELD' AND heldUntil < NOW()`); a second
  concurrent run simply finds nothing left to do. No production evidence of
  horizontal scaling yet; revisit only if it becomes real.

## Why reuse `reservation.cancelled` instead of a new event

`architecture.md` §4 originally designed a dedicated Redis Pub/Sub channel
(`seat:hold_expired`) specifically to bridge a cron job and a WebSocket
gateway that might run on different instances. That bridge is phase 7, not
this phase. The WebSocket gateway (already shipped) instead uses a simpler
in-process `@nestjs/event-emitter` event for reserve/cancel that already
drives both cache invalidation and the broadcast. Reusing it here is not a
workaround — it's semantically exact: a reservation's `heldUntil` expiring
sets its DB `status` to `CANCELLED`, the same enum value user-initiated
cancellation produces. The event name already matches the state transition.

Consequence: `expireHolds` gets working cache invalidation and live broadcast
today, in a single-instance setup, with zero new listener code. Phase 7's job
becomes specifically the cross-instance Redis transport and per-holder direct
"your hold expired" notification (needs socket identity, which does not exist
yet) — narrower and clearer than before.

## Concurrency: why no extra locking is needed

`expireHolds` can only **release** a seat, never allocate one. The existing
safety net for booking (`SELECT ... FOR UPDATE` + the partial unique index
`(seatId, screeningId) WHERE status IN ('HELD','CONFIRMED')`) fully covers the
allocation side. Releasing a row that's already been independently cancelled
by a user (a benign race) just means the release query's `WHERE status =
'HELD'` no longer matches that row — a no-op, not a bug. Both orderings of
that race land on the same final state (`CANCELLED`).

## Components

```
src/cron/
├── cron.module.ts              # imports ReservationsModule; provides the trigger below
└── hold-expiry.cron.ts         # @Cron(EVERY_MINUTE) -> try/catch -> ReservationsService.expireHolds()
```

- `CronModule` imports `ReservationsModule` (already exports `ReservationsService`).
  Registered in `app.module.ts`.
- `ScheduleModule.forRoot()` added once, in `app.module.ts` (not yet present —
  `@nestjs/schedule` is installed but unused before this phase).

### `ReservationsService.expireHolds()` (new method)

```ts
async expireHolds(): Promise<void> {
  const released = await this.reservationsRepo.releaseExpiredHolds(new Date());
  if (released.length === 0) return;

  const byScreening = new Map<number, number[]>();
  for (const r of released) {
    const seatIds = byScreening.get(r.screeningId) ?? [];
    seatIds.push(r.seatId);
    byScreening.set(r.screeningId, seatIds);
  }

  for (const [screeningId, seatIds] of byScreening) {
    this.events.emit(RESERVATION_CANCELLED, { screeningId, seatIds });
  }
}
```

### `ReservationsRepository.releaseExpiredHolds()` (new method)

One atomic raw SQL statement — no find-then-update race window:

```ts
type ExpiredHold = { id: number; screeningId: number; seatId: number };

releaseExpiredHolds(now: Date): Promise<ExpiredHold[]> {
  return this.prisma.$queryRaw<ExpiredHold[]>(Prisma.sql`
    UPDATE "reservation"
    SET status = 'CANCELLED', "heldUntil" = NULL
    WHERE status = 'HELD' AND "heldUntil" < ${now}
    RETURNING id, "screeningId", "seatId"
  `);
}
```

Matches this repository's exact existing convention: `holdSeats` already calls
`tx.$queryRaw<...>(Prisma.sql\`...\`)` for its `FOR UPDATE` query, for the same
reason (Prisma's query builder can't express this). Same tool, same call
shape, same justification — a future reader sees one consistent pattern for
"when we need raw SQL" in this file, not two different ones.

### `hold-expiry.cron.ts` (new file)

```ts
@Injectable()
export class HoldExpiryCron {
  private readonly logger = new Logger(HoldExpiryCron.name);

  constructor(private readonly reservationsService: ReservationsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpireHolds(): Promise<void> {
    try {
      await this.reservationsService.expireHolds();
    } catch (err) {
      this.logger.error('expireHolds tick failed', err as Error);
    }
  }

  // DEFERRED(phase-9): a payment-reconciliation cron job goes here once the
  // Payments module exists (finds timed_out payments, reconciles with Stripe).
}
```

The try/catch is **purely for log visibility** — verified directly against
`node_modules/cron/dist/job.js`'s `fireOnTick()`: it already catches every
tick's error (sync or async) and keeps the schedule running regardless of
whether the previous tick threw. Without our own try/catch, a failure would
still be harmless, just invisible to NestJS's structured `Logger` (the
library's fallback is a raw `console.error`). Combined with `expireHolds`'s
cumulative `WHERE heldUntil < NOW()` query, a DB outage during one or more
ticks simply delays processing — the next successful tick catches everything
that piled up. No retry/backoff logic needed.

Redis unavailability needs no handling here at all: ioredis's default
`retryStrategy` auto-reconnects (already relied on silently by `RedisCache`/
`RedisPubSub` elsewhere in this codebase), and the two listeners this event
triggers (`ReservationCacheListener`, `ReservationBroadcastListener`) already
independently log-and-swallow cache/broadcast failures — established in the
WebSocket gateway phase, unchanged here.

## Errors

| Case | Handling |
|---|---|
| DB unreachable during a tick | Logged via `Logger.error`; next tick (1 min later) catches everything overdue |
| Redis unreachable during broadcast | Already handled by existing listeners (log-and-swallow); DB write already committed regardless |
| No expired holds found | No-op, no event emitted |

## Testing (TDD)

Mirror existing `src/**/test/*.spec.ts` style (Jest, mocked deps).

- **`ReservationsService.expireHolds`**: no released rows → no emit; single
  screening → one emit with all its `seatIds`; multiple screenings → one emit
  per screening, correctly grouped.
- **`ReservationsRepository.releaseExpiredHolds`**: not unit-tested with a
  mocked Prisma client beyond confirming the query is invoked with the right
  shape (matches this repo's existing convention — the raw-SQL correctness
  itself isn't unit-testable through a mock, same as `holdSeats`).
- **`HoldExpiryCron.handleExpireHolds`**: calls
  `reservationsService.expireHolds()`; a thrown error is caught and logged via
  `Logger.error`, never rethrown.

## Deferred-integration markers (in code)

| Seam | Where the comment goes | Phase |
|---|---|---|
| Payment reconciliation cron | in `hold-expiry.cron.ts`, near the existing trigger | 9 |
| Redis Pub/Sub cross-instance transport for hold-expiry | already marked in `screening.gateway.ts` (phase 7, pre-existing) | 7 |

`DEFERRED(phase-6)` at `reservations.service.ts:45` is resolved by this phase.

## Companion changes to `architecture.md`

1. **§6 (Scheduled Jobs):** remove `completeScreenings` from the table (no
   consumer); keep only `expireHolds`, and drop "→ publish to Pub/Sub" from
   its description (that's phase 7, not this phase — this phase emits the
   existing in-process `reservation.cancelled` event instead).
2. **Build order:** mark phase 6 done; note `completeScreenings` as
   intentionally deferred, not forgotten.

## Follow-ups noted for later phases

- Phase 7: Redis Pub/Sub bridge upgrades the transport for cross-instance
  broadcast and adds per-holder direct "your hold expired" notification
  (needs socket identity, deferred in the gateway phase).
- Phase 9: payment reconciliation cron job; also the point at which
  `completeScreenings` may finally get a real reader.
