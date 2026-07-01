# Reservations (HTTP) — Design

**Date:** 2026-07-01
**Build order:** Phase 4 (`architecture.md` line 520)
**Depends on:** Auth, Movies, Screenings (all ✅)

## Goal

Let an authenticated user hold seats for a screening, cancel a held seat, and
list their own reservations. Confirmation (Stripe), real-time broadcast, cron
hold-expiry, and rate limiting are explicitly **later phases** and out of scope
here.

## Scope

**In:**
- `POST /reservations` — hold one or more seats for a screening (all-or-nothing).
- `DELETE /reservations/:id` — cancel a held reservation (owner only).
- `GET /reservations/me` — list the caller's reservations.
- A partial unique index migration (double-booking backstop).
- Wiring `@nestjs/event-emitter` and a cache listener that invalidates the
  screening seat map.

**Out (later phases, by design):**
- Rate limiting on `POST /reservations` (phase 8).
- WebSocket `seat:reserved` / `seat:cancelled` broadcast (phase 5) — will add a
  second listener on the same events, no change to this design.
- Stripe checkout + `HELD → CONFIRMED` confirmation (phase 9).
- Cron hold-expiry job (phase 6) — this phase only *sets* `heldUntil`.
- `reservation_history:user:{id}` cache — deferred (YAGNI). `GET /reservations/me`
  reads from the DB. Add the cache if the endpoint becomes hot; the event
  listener is already the natural invalidation hook.

## Concurrency: preventing double-booking

Target race: two users booking the **same seat, same screening** at the same
instant. Strategy is **pessimistic locking + a DB backstop**:

1. **`SELECT ... FOR UPDATE`** on the requested seat rows serializes concurrent
   reservers of those seats.
2. **READ COMMITTED** isolation (Prisma default) so that when the second racer
   unblocks it re-reads fresh committed data and its existence-check correctly
   sees the first booking → returns `409`. (Under Repeatable Read the check —
   which reads the `reservation` table, not the locked `seat` row — could read a
   stale snapshot and miss the first insert; READ COMMITTED avoids that.)
3. **Partial unique index** as the final backstop, independent of app logic:

   ```sql
   CREATE UNIQUE INDEX "reservation_active_seat_screening_key"
     ON "reservation" ("seatId", "screeningId")
     WHERE status IN ('HELD', 'CONFIRMED');
   ```

   A duplicate insert raises Prisma `P2002`, which the service maps to `409`.
   Cancelled reservations fall outside the `WHERE`, so a cancelled seat can be
   re-booked.

**Transaction flow (reserve):**

```
prisma.$transaction (READ COMMITTED):
  -- lock + existence/ownership-of-hall validation in one query.
  -- ORDER BY id is load-bearing: consistent lock order prevents deadlocks
  -- when two requests lock overlapping seat sets.
  SELECT id FROM seat
    WHERE id = ANY($seatIds) AND "hallId" = $hallId
    ORDER BY id FOR UPDATE

  -- any of these seats already actively reserved for this screening?
  SELECT "seatId" FROM reservation
    WHERE "screeningId" = $screeningId
      AND "seatId" = ANY($seatIds)
      AND status IN ('HELD','CONFIRMED')      -- non-empty -> 409

  INSERT reservations (status=HELD, heldUntil = now + 10min)  -- unique index = backstop
commit
```

The `FOR UPDATE` query returns the seats that exist in the screening's hall; if
its row count < the deduped requested count, some seat id is invalid → `400`.

## Components

Mirrors the screenings module layout.

```
src/reservations/
├── reservations.module.ts        # controller + service + repo + listener
├── reservations.controller.ts    # JwtAuthGuard; @CurrentUser() -> userId
├── reservations.service.ts       # validation, orchestration, emits events
├── reservations.repository.ts    # the $transaction (raw FOR UPDATE + inserts)
├── events/reservation.events.ts  # event-name constants + payload type
├── listeners/cache.listener.ts   # @OnEvent -> ScreeningsCache.delSeatMap
└── dto/create-reservation.dto.ts # { screeningId: number; seatIds: number[] }
```

- `EventEmitterModule.forRoot()` added to `app.module.ts`.
- `ReservationsModule` imports `ScreeningsModule` (for `ScreeningsCache` +
  `ScreeningsRepository`). `PrismaModule`/`RedisModule` are global.
- No cancel DTO — id comes from the route param.

## Endpoints

### `POST /reservations` (auth)
Body: `{ screeningId: number, seatIds: number[] }` (validated by
class-validator: `seatIds` non-empty array of positive ints; deduped in the
service).

Rules, in order:
1. Screening exists, status `SCHEDULED`, `startTime > now` → else `404`/`400`.
2. Every `seatId` belongs to the screening's hall (enforced by the locking
   query's `hallId` filter + count check) → else `400`.
3. No requested seat is already `HELD`/`CONFIRMED` for this screening → else
   `409` (also the unique-index/`P2002` outcome).
4. Insert N `HELD` rows, `heldUntil = now + 10min`, all-or-nothing.
5. Emit `reservation.created { screeningId }`.

Response `201`: the created reservations.

### `DELETE /reservations/:id` (auth)
- Reservation must exist and belong to the caller → else `404` (not `403`, to
  avoid leaking existence).
- Must be `HELD`. Cancelling a `CONFIRMED` booking involves a refund → deferred
  to the payment phase → `409`/`400` here.
- Set status `CANCELLED`; emit `reservation.cancelled { screeningId }`.
- Response `200`: the cancelled reservation.

### `GET /reservations/me` (auth)
- The caller's reservations, newest first, with seat + screening + movie basics
  for display. Reads from DB (no cache this phase).

## Events & cache invalidation

Single concern this phase: keep `seat_map:screening:{id}` fresh.

```
ReservationsService
  emits 'reservation.created'   { screeningId }
  emits 'reservation.cancelled' { screeningId }

listeners/cache.listener.ts
  @OnEvent('reservation.created')
  @OnEvent('reservation.cancelled')  -> ScreeningsCache.delSeatMap(screeningId)
```

Event names + payload type live in `events/reservation.events.ts` so the phase-5
WebSocket listener can subscribe to the same constants without duplication.

## Errors

| Case | Status |
|---|---|
| Screening not found / not `SCHEDULED` | `404` |
| Screening already started | `400` |
| Unknown seat id / seat not in hall | `400` |
| Empty / malformed `seatIds` | `400` (validation) |
| Any seat already held/booked (incl. `P2002`) | `409` |
| Cancel: reservation not found or not owner | `404` |
| Cancel: reservation not `HELD` | `409` |

## Testing (TDD)

Mirror existing `src/**/test/*.spec.ts` style.

- **Service** (mocked repo/cache/emitter): screening validation (missing,
  cancelled, past), seat-belongs-to-hall, conflict → `409`, all-or-nothing
  rollback on partial conflict, ownership + `HELD`-only on cancel, events
  emitted with correct `screeningId`.
- **Controller**: `JwtAuthGuard` applied, `userId` sourced from `@CurrentUser()`
  and never from the body, param parsing.
- **Repository**: conflict path surfaces (`P2002` → conflict) and the deduped
  count/`FOR UPDATE` validation.
- **Cache listener**: both events call `delSeatMap` with the payload's
  `screeningId`.

## Migration

Hand-written SQL migration (Prisma schema can't express a partial `WHERE`
index) creating `reservation_active_seat_screening_key` as above. Applied via
`prisma migrate`; the index is not represented in `schema.prisma`.

## Follow-ups noted for later phases

- Phase 5: WebSocket listener on `reservation.created`/`cancelled` → broadcast.
- Phase 6: cron `expireHolds` reads `heldUntil` set here.
- Phase 8: rate limit `POST /reservations` (3/min per user).
- Phase 9: `HELD → CONFIRMED` on payment success; refund-aware cancel of
  `CONFIRMED`.
- `architecture.md` line 52 says "Repeatable Read"; this phase uses READ
  COMMITTED for the reservation transaction — update that line to match.
