# Load Testing Module — Design Spec

## Goal

Add a load-testing module (`backend/load-test/`) that:

1. Validates the app holds up under realistic mixed HTTP traffic.
2. Proves the seat-reservation concurrency control (`SELECT FOR UPDATE` + a DB unique
   constraint on `(screeningId, seatId)`) is actually race-safe under contention — not just
   correct on paper.
3. Finds the system's real breaking point by ramping load until something redlines, using the
   Prometheus/Grafana stack (`backend/docker-compose.monitoring.yml`, built in the observability
   work) as the lens for understanding *why* it broke, not just *that* it broke.

This is explicitly a **learning tool**, not just a CI gate: the primary use case is running a
scenario, watching the Grafana dashboard while it runs, and building intuition for how this
system's specific bottlenecks (DB connection pool, event loop, lock contention) show up before
they become outages.

**Dependency:** the browse → login → seat-map → reserve flow this module drives (`/movies`,
`/screenings/:id/seats`, `/auth/login`, `/reservations`) is fully implemented on `main` already —
confirmed by reading the controllers directly. Watching the *Grafana* dashboards while a scenario
runs additionally needs the observability stack from
`docs/superpowers/specs/2026-07-12-observability-metrics-design.md` (`/metrics` endpoint,
`docker-compose.monitoring.yml`). That currently lives on the `feat/payments-phase9` branch,
unmerged. The load-testing module itself can be implemented and run against `main` today
(thresholds still enforce via Artillery's own output); the Grafana-watching part of the
ramp-to-failure workflow needs whichever branch has the observability work merged in.

**Tool:** Artillery, per the sketch already in `architecture.md` (§9, Observability Stack). Two
of the three scenarios below extend that sketch directly; the third (ramp-to-failure) is new.
`artillery` is not yet a dependency anywhere in the repo — it's added as a `backend` devDependency
by this work.

**API prefix:** every route in this document is relative to the app's global prefix, e.g.
`POST /reservations` means `POST /api/v1/reservations` on the wire.

---

## File Layout

```
backend/load-test/
  seed.ts                       — creates test users + one hall/screening with a large seat layout;
                                   writes the generated screeningId/seatId to seed-output.json
  seed-output.json              — gitignored; runtime data written by seed.ts, read by processor.js
  processor.js                  — Artillery hooks: loads seed-output.json, logs in each VU once,
                                   reuses the session cookie, decides probabilistically whether a
                                   VU attempts a booking
  scenarios/
    mixed-read-write.yml        — GET /movies, GET /screenings/:id/seats, ~20% POST /reservations
    hot-seat-contention.yml     — 100 VUs racing to reserve the same seat
    ramp-to-failure.yml         — stepped arrival rate, mixed traffic, run to find the ceiling
  README.md                     — the learning runbook (see below)
```

Lives under `backend/`, alongside `docker-compose.monitoring.yml`, as dev tooling rather than
application code — not part of `src/`, not shipped in `dist/`.

**npm scripts** (`backend/package.json`):

| Script | Does |
|---|---|
| `load-test:seed` | `prisma migrate reset --force && ts-node load-test/seed.ts` |
| `load-test:mixed` | `npm run load-test:seed && artillery run load-test/scenarios/mixed-read-write.yml` |
| `load-test:contention` | `npm run load-test:seed && artillery run load-test/scenarios/hot-seat-contention.yml` |
| `load-test:ramp` | `npm run load-test:seed && artillery run load-test/scenarios/ramp-to-failure.yml` |

Each script resets the DB before running, so every invocation starts from known-clean state —
no leftover `HELD`/`BOOKED` seats from a prior run poisoning the next one.

**Prerequisite (documented in the README, not automated):** the app (`npm run start:dev`) and
the monitoring stack (`docker compose -f docker-compose.monitoring.yml up -d`) must already be
running before invoking any `load-test:*` script. These scripts drive traffic at
`localhost:3000`; they do not start the app themselves.

---

## Auth, rate limiting, and seat capacity

Two constraints discovered by reading the actual endpoint code (not part of the original
sketch, but binding):

- **`POST /reservations` is rate-limited to 3 requests/60s, keyed per-user**
  (`rate_limit:user:<id>:reservations:create` in `RateLimitGuard` /
  `reservations.controller.ts`). Not a blocker, but it means a small reused user pool would
  generate false-positive 429s under any real load — the pool must be sized so no single user
  attempts more than one booking per run.
- **Seat availability is finite and derived per-screening** (no seat exists in isolation from a
  `Hall`) — if every virtual user unconditionally tried to book, high-arrival-rate scenarios
  would exhaust real seats and produce genuine 409s that look like failures but are just running
  out of test fixture, not a bug.

**Design response:** only a fraction of virtual users in `mixed-read-write` and
`ramp-to-failure` attempt a booking — the rest browse only, modeling a realistic browse-to-book
ratio. `processor.js` decides this per-VU with a ~20% probability check in its `beforeScenario`
hook. `hot-seat-contention` is the exception: all 100 of its VUs book unconditionally, because
contention on one seat is the entire point of that scenario.

`seed.ts` creates:
- **2,500 test user accounts**, all sharing one pre-computed bcrypt hash (hashing once and
  reusing it, rather than hashing per-user, is what makes seeding thousands of accounts fast —
  a per-user `bcrypt.hash` call at cost factor 10 would take real wall-clock time at this scale).
  Emails follow `loadtest<N>@test.local`, password is a fixed known string, `emailVerified: true`
  (the registration/OTP flow is bypassed by inserting directly).
- **One `Hall`** ("Load Test Hall") with **3,000 `Seat` rows**, generated in bulk
  (`prisma.seat.createMany`), sized above the ~2,280 booking attempts the heaviest scenario
  (ramp-to-failure, ~20% of ~11,400 total arrivals) is expected to generate.
- **One `Movie`** (status `PUBLISHED`) and **one `Screening`** referencing that hall/movie, with
  `startTime` in the future and `status: SCHEDULED`.
- `seed-output.json`: `{ "screeningId": <id>, "hotSeatId": <id> }` — the ids are only known after
  seeding runs (autoincrement, reset by `prisma migrate reset`), so scenario YAML can't hardcode
  them. `processor.js` reads this file at scenario start and injects both values into
  `context.vars`.

`processor.js`'s `beforeScenario` hook also handles login: each virtual user performs one
`POST /auth/login` using a credential drawn from the 2,500-account pool (cycled by a counter, so
no two concurrently-running VUs reuse the same account within the same run), and stores the
resulting session cookie for reuse across the rest of that VU's flow. Login traffic itself is
*not* part of the measured load — it happens once per VU, before the timed scenario body.

---

## Scenarios

### 1. `mixed-read-write.yml` — baseline realistic load

60 seconds @ 50 arrivals/sec. Every virtual user: `GET /movies` → `GET /screenings/:id/seats`.
~20% of virtual users (decided in `processor.js`) additionally `POST /reservations` for a
randomly chosen `AVAILABLE` seat from that seat-map response.

**Thresholds** (Artillery `ensure`/`expect` plugin): p95 latency < 500ms, error rate < 1%.
A failing threshold exits Artillery non-zero — this scenario is meant to be a genuine pass/fail
gate on "does normal traffic work." Because of the sizing in the Auth section above, a real
error-rate breach here means an actual problem, not fixture exhaustion.

### 2. `hot-seat-contention.yml` — correctness under contention

100 virtual users, all `POST /reservations` for the *same* seat (`hotSeatId` from
`seed-output.json`) on the same screening, fired within a tight arrival window (no ramp —
deliberately simultaneous).

**Thresholds:** exactly 1 response with HTTP 201, the other 99 with HTTP 409, asserted via
per-request `expect` checks aggregated at the end of the run. This scenario is not measuring
throughput or latency — it's a correctness proof that the locking design does not allow a double
booking under real concurrent load. If this ever fails, it means the `SELECT FOR UPDATE` +
unique-constraint design has a gap.

### 3. `ramp-to-failure.yml` — finding the ceiling

Same mixed-traffic flow as scenario 1 (including the ~20% booking probability), but arrival rate
steps up over time instead of staying fixed: 10 → 20 → 50 → 100 → 200 req/sec, 30 seconds per
step (~11,400 total arrivals, ~2,280 expected booking attempts — within the 2,500-user,
3,000-seat capacity seeded above).

**Thresholds:** p95 < 500ms is still declared, but is expected to start failing at some step —
*that failure point is the deliverable*, not a bug. No error-rate assertion on this scenario; it
exists to be run interactively while watching Grafana, not as an automated gate.

---

## Learning Runbook (`backend/load-test/README.md`)

A short doc, written for whoever is running these tests to build intuition, not just get a
pass/fail. Maps what you'll likely see redline first in the Grafana dashboard
(`movie-reservation-system.json`, built in the observability work) to the underlying cause,
using the same priority table already in `architecture.md` §9:

| Panel | What redlining first suggests |
|---|---|
| DB connection pool usage | Pool exhaustion — requests queueing on a DB connection, not on CPU. Fix: raise pool size or reduce per-request DB round-trips. |
| Event-loop lag | Something synchronous/blocking on the Node event loop — likely WebSocket broadcast fan-out (`ReservationBroadcastListener`) or a heavy synchronous computation. |
| HTTP p95 climbing while error rate stays flat | Queueing, not rejection — the app is falling behind but not yet shedding load. Early warning sign, not yet a failure. |
| HTTP error rate climbing | Actual rejections/timeouts — the system has passed its capacity ceiling, not just slowed down. |
| Redis hit rate dropping | Cache layer degrading under load — check `screenings.cache`/`movies.cache` TTLs and whether cache invalidation (`ReservationCacheListener`) is firing too aggressively under write load. |

The README instructs: run `npm run load-test:ramp`, watch the dashboard live, note which panel
moves first, and cross-reference this table.

---

## Testing

The load-test module itself is test tooling, not application code under `src/`, so it is
exempt from the Jest unit-test convention used elsewhere in this repo. Its own "test" is that it
runs successfully end-to-end — validated manually (see Verification below), the same way the
observability module's Grafana dashboard was validated by manual smoke test rather than a unit
spec.

## Verification (for the implementation plan to include as its final task)

1. Bring up app + `docker-compose.yml` (app deps) + `docker-compose.monitoring.yml`.
2. Run `npm run load-test:mixed` — confirm it passes both thresholds.
3. Run `npm run load-test:contention` — confirm exactly one 201 and ninety-nine 409s.
4. Run `npm run load-test:ramp` while watching Grafana — confirm the dashboard panels move
   as traffic increases, and note (in the plan's completion report, not committed anywhere) which
   panel redlined first.
