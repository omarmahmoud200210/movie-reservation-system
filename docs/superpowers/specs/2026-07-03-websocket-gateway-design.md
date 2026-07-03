# WebSocket Gateway — Real-Time Seat Updates — Design

**Date:** 2026-07-03
**Build order:** Phase 5 (`architecture.md` line 521)
**Depends on:** Auth, Movies, Screenings, Reservations (HTTP) (all ✅)

## Goal

Push live seat-status changes and derived screening counts to **every visitor**
watching a screening — logged in or not — so the seat map and its summary
(held / booked / seats-left) update the instant someone reserves or cancels.

The real-time layer is public: it serves anonymous browsers exactly like
authenticated ones. Auth, when present, only *enriches* a socket with an
identity for a later phase; it never gates access.

## Scope

**In:**
- A Socket.io `@WebSocketGateway` with room-per-screening (`screening:{id}`).
- Optional-auth identity attachment on connect (httpOnly `access_token` cookie).
- `join:screening` handling with an **ack callback**: joins the room and returns
  the initial seat map + summary; returns an error result for a bad screening.
- A second listener on the existing `reservation.created` / `reservation.cancelled`
  in-process events that broadcasts granular seat deltas + a summary to the room.
- `ScreeningsService.getScreeningSummary(id)` — counts derived from the existing
  cache-aside seat map (no new Redis structure).
- Enriching the reservation event payload with the changed `seatIds`.

**Out (later phases, by design):**
- `seat:hold_expired` via Redis Pub/Sub bridge (phase 7) — needs the Cron job
  (phase 6) and Redis Instance 2 subscription. Marked `DEFERRED(phase-7)`.
- Per-holder direct socket notification ("your hold expired") — needs the
  identity attached here plus the phase-7 pub/sub message. Marked `DEFERRED(phase-7)`.
- `BOOKED` / payment `HELD → CONFIRMED` seat transitions (phase 9).
- Atomic Redis counters for the summary — **explicitly deferred to phase 11**
  (load testing). Decision below.

## Authentication: optional, cookie-based

`architecture.md` §3 originally specified a hard `WsJwtGuard` reading
`handshake.auth.token`. Two corrections, both settled during design:

1. **Transport = httpOnly cookie**, not `handshake.auth.token`. The app never
   exposes the JWT to JavaScript (`jwt.strategy.ts` reads `req.cookies.access_token`);
   the browser sends that cookie on the WS handshake automatically. Using
   `handshake.auth.token` would force the token into JS and defeat httpOnly.
2. **Optional, not required.** The HTTP seat map (`GET /screenings/:id/seats`) is
   **public / unguarded** (`screenings.controller.ts`). Requiring a login for the
   *live* version would be inconsistent, and this phase broadcasts only
   room-level data (no per-user payloads). So the gateway **never rejects** a
   handshake.

**Mechanism:** `handleConnection(socket)` parses `access_token` from
`socket.handshake.headers.cookie`; if present and valid (verified with
`JwtService` + `JWT_ACCESS_SECRET`), it sets `socket.data.user = { id, email,
role, name }`. Missing/invalid → socket stays anonymous, connection proceeds.
The attached identity is unused this phase — it exists so phase-7 per-holder
targeting has a foundation (`DEFERRED(phase-7)` marker at the attachment site).

## Components

Follows the `src/gateway/` layout in `architecture.md` (line 496).

```
src/gateway/
├── gateway.module.ts               # imports ScreeningsModule; provides the below
├── screening.gateway.ts            # @WebSocketGateway: connect + join:screening
├── ws-identity.service.ts          # parse cookie -> verify JWT -> AuthUser | null
├── reservation-broadcast.listener.ts  # @OnEvent reservation.* -> emit to room
└── test/
    ├── screening.gateway.spec.ts
    ├── ws-identity.service.spec.ts
    └── reservation-broadcast.listener.spec.ts
```

- `GatewayModule` imports `ScreeningsModule` (for `ScreeningsService`, already
  exported) and `JwtModule`/`JwtService` for verification. Registered in
  `app.module.ts`. `EventEmitterModule` is already global.
- The gateway holds the Socket.io `Server` (`@WebSocketServer()`) and exposes
  `emitToRoom(screeningId, event, payload)` used by the listener.

### `ScreeningGateway` (`screening.gateway.ts`)

- `@WebSocketGateway({ cors: { origin: FRONTEND_URL, credentials: true } })` —
  `credentials: true` is required for the browser to send the cookie
  cross-origin on the handshake.
- `handleConnection(socket)`: attach identity via `WsIdentityService` (never
  throws; anonymous on failure).
- `@SubscribeMessage('join:screening')` with an **ack callback**:
  1. Validate the screening via `ScreeningsService` (unknown or `CANCELLED` →
     ack `{ ok: false, error }`, do not join).
  2. `socket.join('screening:{id}')`.
  3. Build initial state: `seats = getSeatMap(id)`, `summary = getScreeningSummary(id)`.
  4. Ack `{ ok: true, seats, summary }`.
  The ack ties success/failure to *that* join request — no ambiguous global
  `error` event.

### `WsIdentityService` (`ws-identity.service.ts`)

- `identify(socket): AuthUser | null` — parse the `cookie` header, extract
  `access_token`, `jwt.verify` it, map the payload to `AuthUser`. Any failure
  (no cookie, no token, invalid/expired) returns `null`. No exceptions escape.

### `ReservationBroadcastListener` (`reservation-broadcast.listener.ts`)

Second listener on the same events the cache listener already uses.

```
@OnEvent('reservation.created')   -> emit 'seat:reserved'  { screeningId, seatIds, status: 'HELD' }
@OnEvent('reservation.cancelled') -> emit 'seat:cancelled' { screeningId, seatIds, status: 'AVAILABLE' }
                                     then emit 'screening:summary' { ...getScreeningSummary(id) }
```

- Seat deltas come straight from the (now enriched) event payload — no lookup.
- The summary is computed from `getScreeningSummary(id)` after the delta emit.
- **Resilience:** a failed emit or summary computation is logged, never thrown —
  a broadcast must never break the HTTP reserve/cancel that triggered it. If the
  summary computation fails, the seat delta still goes out.

## Summary: derived from the seat-map cache (no new Redis)

The summary is **not** a new incremental Redis counter. It is derived from the
existing cache-aside seat map, which is already invalidated on every reservation
change (`reservation-cache.listener.ts`).

New method on `ScreeningsService` (next to `getSeatMap`, sharing its cache):

```ts
async getScreeningSummary(screeningId: number) {
  const seatMap = await this.getSeatMap(screeningId); // warm -> Redis, cold -> DB + rewarm
  let held = 0, booked = 0;
  for (const s of seatMap) {
    if (s.status === SeatStatus.HELD) held++;
    else if (s.status === SeatStatus.BOOKED) booked++;
  }
  const capacity = seatMap.length; // one entry per hall seat
  return {
    screeningId, capacity, held, booked,
    available: capacity - held - booked, // seats left
    reserved: held + booked,             // reservations number (seats taken)
  };
}
```

**Why derive instead of an atomic Redis counter (the alternative considered):**
- Reserve/cancel are gated by `SELECT FOR UPDATE`; the write is the bottleneck.
  Two indexed reads to build the seat map are noise beside it — and on a warm
  cache the summary is a **pure Redis read** with no DB hit at all.
- The seat map is invalidated on every change and rebuilt from the DB, so the
  derived summary **cannot drift**. A separate counter is a second source of
  truth requiring lazy seeding, TTL reseeds, and phase-7 cron decrements — new
  code and new failure modes to optimize a cost we have not measured.
- Optimize with data, not guesses: phase 10 (observability) + phase 11 (load
  testing) will show whether the seat-map recompute-on-change is a real hotspot.
  If so, add atomic counters then, knowing the exact bottleneck. `DEFERRED(phase-11)`
  marker on `getScreeningSummary`.

Listener ordering (cache-invalidate vs broadcast, both on the same event) is a
non-issue: `getScreeningSummary` calls `getSeatMap`, which after invalidation
just recomputes and re-warms — order-independent and always correct.

## Enriching the reservation event payload

The listener needs to know *which* seats changed. The one change outside
`src/gateway/`:

- `ReservationChangedPayload` (`reservations/events/reservation.events.ts`) gains
  `seatIds: number[]`.
- `ReservationsService.reserve` emits with the held seat ids (it already has them
  from the created reservations); `.cancel` emits with the cancelled seat's id.
- The existing `ReservationCacheListener` reads only `screeningId` — it ignores
  the new field, so this is backward compatible and its tests are unaffected.

The `DEFERRED(phase-5)` marker in `reservation-cache.listener.ts` (which reserved
this listener slot) is resolved by this phase.

## Event contract

**Client → Server**

| Event | Payload | Response |
|---|---|---|
| `join:screening` | `{ screeningId: number }` | ack `{ ok: true, seats, summary }` or `{ ok: false, error }` |

**Server → Client / Room**

| Event | Direction | Payload |
|---|---|---|
| `seat:reserved` | Server → Room | `{ screeningId, seatIds: number[], status: 'HELD' }` |
| `seat:cancelled` | Server → Room | `{ screeningId, seatIds: number[], status: 'AVAILABLE' }` |
| `screening:summary` | Server → Room | `{ screeningId, capacity, held, booked, available, reserved }` |

`seat:initial_state` from `architecture.md` §3 is replaced by the **ack payload**
of `join:screening` (`{ seats, summary }`) — a cleaner request/response tie than
a separate emit.

**Reconnection:** Socket.io auto-reconnects; on every `connect` the client
re-emits `join:screening` and gets a fresh ack — full resync, no server state to
recover.

## Errors

| Case | Handling |
|---|---|
| `join:screening` unknown / `CANCELLED` screening | ack `{ ok: false, error }`, no room join |
| Invalid/missing/expired JWT cookie on connect | socket stays anonymous, connection proceeds |
| Broadcast emit fails | logged, swallowed — never breaks the triggering HTTP request |
| Summary computation fails | logged; seat delta still emitted, summary skipped |

## Testing (TDD)

Mirror existing `src/**/test/*.spec.ts` style (Jest, mocked deps).

- **`WsIdentityService`**: valid cookie → `AuthUser`; missing cookie / missing
  `access_token` / malformed / expired token → `null`; never throws.
- **`ScreeningGateway`**: `join:screening` joins `screening:{id}` and acks
  `{ ok: true, seats, summary }`; unknown/cancelled screening acks
  `{ ok: false }` and does not join; `handleConnection` attaches
  `socket.data.user` when the cookie is valid and leaves it undefined otherwise.
- **`ReservationBroadcastListener`**: `reservation.created` emits `seat:reserved`
  with the payload's `seatIds` + `screening:summary`; `reservation.cancelled`
  emits `seat:cancelled` + summary; a throwing emit is swallowed (no rethrow).
- **`ScreeningsService.getScreeningSummary`**: counts held/booked/available/
  reserved correctly, including an all-available and a mixed seat map.
- **Reservation event enrichment**: `reserve` / `cancel` emit payloads now carry
  `seatIds` (extend the existing reservations.service tests).

## Deferred-integration markers (in code)

Same convention as the reservations phase: a single greppable
`// DEFERRED(phase-N): <what plugs in here>` at the exact seam.

| Seam | Where the comment goes | Phase |
|---|---|---|
| Redis Pub/Sub `seat:hold_expired` subscription | in the gateway, near the broadcast methods | 7 |
| Per-holder direct notification | at the `socket.data.user` attachment in `handleConnection` | 7 |
| `BOOKED` on payment confirm | in `reservation-broadcast.listener` status mapping | 9 |
| Atomic Redis summary counters | on `getScreeningSummary` | 11 |

No stub classes or dead code — comments only.

## Companion changes to `architecture.md`

1. **§3 (Real-Time Layer):** replace `handshake.auth.token` with the httpOnly
   cookie transport; note optional-auth (public visitors); replace
   `seat:initial_state` emit with the `join:screening` ack; add `screening:summary`
   to the event contract.
2. **Build order:** add a late **"Integration Wiring" phase (phase 13)** whose
   job is to walk every `DEFERRED(phase-N)` marker across all modules and connect
   it to the now-existing module — one deliberate pass to close all seams
   (includes: gateway ↔ phase-7 pub/sub, per-holder targeting, phase-9 BOOKED
   transitions, and a reconcile of any phase-11 summary counters).

## Follow-ups noted for later phases

- Phase 6: cron `expireHolds` releases expired holds (sets the seats this
  gateway will later broadcast as freed).
- Phase 7: pub/sub bridge delivers `seat:hold_expired` to the gateway; gateway
  broadcasts to the room **and** direct-notifies the holder via `socket.data.user`.
- Phase 9: `HELD → CONFIRMED` emits a `BOOKED` seat transition through this
  listener.
- Phase 11: revisit atomic Redis summary counters if load testing shows the
  derived summary is a hotspot.
