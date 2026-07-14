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

**Dependency:** this spec assumes the observability stack from
`docs/superpowers/specs/2026-07-12-observability-metrics-design.md` is present — `/metrics`
endpoint, `docker-compose.monitoring.yml`, and the Grafana dashboard. That work currently lives
on the `feat/payments-phase9` branch and has not yet merged to `main`; the load-testing module's
implementation plan should target whichever branch has that work by the time it's executed.

**Tool:** Artillery, per the sketch already in `architecture.md` (§9, Observability Stack). Two
of the three scenarios below extend that sketch directly; the third (ramp-to-failure) is new.

---

## File Layout

```
backend/load-test/
  seed.ts                       — creates test users + one screening with a known seat layout
  processor.js                  — Artillery hook: logs in each VU once, reuses the session cookie
  scenarios/
    mixed-read-write.yml        — GET /movies, GET /screenings/:id/seats, POST /reservations
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

## Auth

`seed.ts` creates 150 test user accounts (covers the largest scenario's VU count, the
ramp-to-failure ceiling) with known email/password credentials, plus one screening with a full
seat layout (enough seats that `mixed-read-write` doesn't exhaust availability mid-run).

`processor.js` implements an Artillery `beforeScenario` hook: each virtual user performs one
`POST /auth/login` using a credential drawn from the seeded pool, and stores the resulting
session cookie in `context.vars` for reuse across the rest of that VU's flow. This means login
traffic itself is *not* part of the measured load (it happens once per VU, before the timed
scenario body).

---

## Scenarios

### 1. `mixed-read-write.yml` — baseline realistic load

60 seconds @ 50 arrivals/sec. Each virtual user: `GET /movies` → `GET /screenings/:id/seats` →
`POST /reservations` for a randomly chosen available seat.

**Thresholds** (Artillery `ensure`/`expect` plugin): p95 latency < 500ms, error rate < 1%.
A failing threshold exits Artillery non-zero — this scenario is meant to be a genuine pass/fail
gate on "does normal traffic work."

### 2. `hot-seat-contention.yml` — correctness under contention

100 virtual users, all `POST /reservations` for the *same* seat on the same screening, fired
within a tight arrival window (no ramp — deliberately simultaneous).

**Thresholds:** exactly 1 response with HTTP 201, the other 99 with HTTP 409, asserted via
per-request `expect` checks aggregated at the end of the run. This scenario is not measuring
throughput or latency — it's a correctness proof that the locking design does not allow a double
booking under real concurrent load. If this ever fails, it means the `SELECT FOR UPDATE` +
unique-constraint design has a gap.

### 3. `ramp-to-failure.yml` — finding the ceiling

Same mixed-traffic flow as scenario 1, but arrival rate steps up over time instead of staying
fixed: 10 → 20 → 50 → 100 → 200 req/sec, 30 seconds per step.

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
