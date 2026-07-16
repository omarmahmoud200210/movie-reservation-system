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
    soak-mixed.yml              — flat mixed traffic held for 15 minutes, watching for drift
    spike-recovery.yml          — sudden burst then drop, watching whether the app recovers
    multi-hot-contention.yml    — 20 simultaneous hot seats across 20 screenings, not just one
    checkout-payment.yml        — drives the real Stripe checkout-session creation path
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
| `load-test:soak` | `npm run load-test:seed && artillery run load-test/scenarios/soak-mixed.yml` |
| `load-test:spike` | `npm run load-test:seed && artillery run load-test/scenarios/spike-recovery.yml` |
| `load-test:multi-contention` | `npm run load-test:seed && artillery run load-test/scenarios/multi-hot-contention.yml` |
| `load-test:checkout` | `npm run load-test:seed && artillery run load-test/scenarios/checkout-payment.yml` |

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
- **`POST /payments/checkout-session` is rate-limited to 5 requests/60s, keyed per-user**
  (`payments.controller.ts:26`). Same sizing rule applies: no single user in `checkout-payment.yml`
  attempts more than one checkout-session creation per run.
- **`payments.service.ts` calls the real Stripe API** (`stripe.checkout.sessions.create`,
  `payments.service.ts:105-121`) — there is no mock/test-mode stub in this codebase. Load-testing
  the checkout path means real network calls to Stripe (against a test-mode secret key), subject to
  Stripe's own rate limits. `checkout-payment.yml` is therefore deliberately low-volume (see below)
  and kept out of `load-test:ramp`/`load-test:soak` — it is not something to blast at 200 req/s.
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
- **20 additional `Screening` rows** ("hot screenings"), same hall and movie, each paired with one
  distinct `Seat` from the already-seeded 3,000 (seats are not screening-scoped in the schema — a
  `Hall`'s seats can be reused across any of its `Screening`s — so no extra seats are needed).
  These exist solely for `multi-hot-contention.yml`, which needs 20 independent hot seats instead
  of the single one `hot-seat-contention.yml` uses.
- `seed-output.json`: `{ "screeningId": <id>, "hotSeatId": <id>, "hotScreenings": [{ "screeningId": <id>, "hotSeatId": <id> }, ...20 entries] }`
  — the ids are only known after seeding runs (autoincrement, reset by `prisma migrate reset`), so
  scenario YAML can't hardcode them. `processor.js` reads this file at scenario start and injects
  the relevant values into `context.vars`.

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

### 4. `soak-mixed.yml` — sustained load (catches what a 60-second run can't)

Same mixed-traffic flow as scenario 1, held flat for **15 minutes** at a conservative arrival rate
(default 40 req/sec — deliberately below whatever ceiling `ramp-to-failure` finds, since the point
is to run *stable*, not to redline). A short burst can't reveal connection-pool leaks, slow memory
growth, or Redis TTL/cache-invalidation drift under sustained write pressure — those only show up
after minutes of continuous traffic.

**Thresholds:** `maxErrorRate: 1` only — no p95 gate, since the signal this scenario is after
(gradual latency creep, memory climbing on the Grafana process-memory panel, DB connection pool
usage trending up instead of holding flat) is read visually off Grafana, not asserted by Artillery.
This is a watch-and-observe run, same spirit as `ramp-to-failure`, just flat instead of stepped.

### 5. `spike-recovery.yml` — does it recover, not just does it break

Three phases: 30s baseline @ 10 req/sec → 20s spike @ 300 req/sec → 60s back at 10 req/sec.
`ramp-to-failure` finds the ceiling under a gradual climb; this answers a different question —
after a sudden overload, does the system recover once load drops, or does it stay wedged (pool
exhausted, event loop still catching up, requests still queued)?

**Thresholds:** none declared globally — the spike phase is expected to degrade. The check is
post-hoc: parse Artillery's JSON report (`--output`) and compare p95 latency in the final baseline
phase against the initial baseline phase. Recovery is "final-phase p95 within ~1.5x of
initial-phase p95"; anything worse means the system doesn't shed a spike cleanly.

### 6. `multi-hot-contention.yml` — contention spread across many hot resources

100 VUs per screening × 20 screenings (2,000 VUs total, fired in one tight arrival window), each
group of 100 racing for the one hot seat on *its* screening. `hot-seat-contention.yml` proves the
lock is correct for one hot resource; this proves it holds up when contention is spread across many
simultaneously — the more realistic "opening night, twenty popular showtimes" shape, and a check
that per-seat/per-screening locking doesn't serialize across *unrelated* screenings (a global lock
bug wouldn't show up with only one hot seat in play).

**Thresholds:** per-response `expect: [201, 409]` (no 5xx/429 noise), same as scenario 2. The
aggregate correctness check — *exactly one 201 per screening group, not just 20 total across the
run* — needs `processor.js` to log each response's `screeningId` + status to a file
(`multi-contention-results.ndjson`, gitignored), since Artillery's own counters aggregate across
the whole run and can't be grouped by screening. Verification parses that file and asserts each of
the 20 screening groups independently produced exactly one 201.

### 7. `checkout-payment.yml` — load on the real payment path

`POST /reservations` (get a `HELD` reservation) then `POST /payments/checkout-session`
(`payments.controller.ts:27`) for it. This is the only scenario that exercises the payment-service
code path (`payments.service.ts`) — everything else stops at reservation creation. Deliberately
low-volume: 60s @ 5 req/sec, one attempt per virtual user. Two reasons for keeping this small,
unlike the other scenarios:

- **Real Stripe calls.** `checkout-session` creation hits the live Stripe API (test-mode secret
  key) — there's no mock in this codebase (confirmed by reading `payments.service.ts`). This is
  bounded by Stripe's own rate limits, not just this app's.
- **Per-user rate limit is tighter here** (5/60s vs. 3/60s on reservations), so the sizing
  discipline from the Auth section applies again.

**Thresholds:** `maxErrorRate: 1`. No p95 gate — Stripe's own API latency is out of this app's
control and would make the threshold meaningless. This scenario is excluded from
`load-test:ramp`/`load-test:soak`'s traffic mix and only ever run standalone, on purpose.

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
| Process memory climbing steadily over 15 minutes (not sawtoothing with GC) | A leak, not normal GC behavior — only visible in `soak-mixed`, invisible in the 60s scenarios. |
| DB connection pool usage or p95 staying elevated after `spike-recovery`'s load has dropped back to baseline | The system didn't shed the spike cleanly — something (pool, queue, retry storm) is still working through backlog instead of catching up. |

The README instructs: run `npm run load-test:ramp`, watch the dashboard live, note which panel
moves first, and cross-reference this table. `load-test:soak` and `load-test:spike` are read the
same way, just watching for drift-over-time and recovery-after-drop respectively instead of a
single breaking point.

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
5. Run `npm run load-test:soak` while watching Grafana — confirm no threshold breach and note
   whether any panel (memory, DB pool) trends upward over the full 15 minutes rather than holding
   flat.
6. Run `npm run load-test:spike` — confirm the post-hoc p95 comparison shows the final baseline
   phase recovering to within ~1.5x of the initial baseline phase.
7. Run `npm run load-test:multi-contention` — confirm all 20 screening groups independently
   produced exactly one 201 and ninety-nine 409s each (not just 20 total across the run).
8. Run `npm run load-test:checkout` (requires a valid Stripe test-mode `STRIPE_SECRET_KEY` in
   `.env`) — confirm it passes the `maxErrorRate: 1` threshold.
