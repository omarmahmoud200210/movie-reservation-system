# Load Testing

Artillery-based load tests for the reservation flow. See
`docs/superpowers/specs/2026-07-15-load-testing-design.md` for the full design rationale.

## Prerequisites

Before running any `load-test:*` script:

1. The app is running: `npm run start:dev` (from `backend/`).
2. Postgres/Redis are up: `npm run docker:up:dev` (from `backend/`).
3. (Optional, for watching metrics live) The monitoring stack is up:
   `docker compose -f docker-compose.monitoring.yml up -d` (from `backend/`, requires the
   observability module — see the Dependency note in the design spec).

Each `load-test:*` script resets and reseeds the database before running, so every invocation
starts from a known-clean state. **This means running any load-test script destroys existing
local dev data** — do not run these against a database you care about.

## Scenarios

| Script | What it does |
|---|---|
| `npm run load-test:mixed` | 60s @ 50 req/s mixed browse/book traffic. Pass/fail gate: p95 < 500ms, error rate < 1%. |
| `npm run load-test:contention` | 100 users race to book the same seat. Correctness check: exactly one should succeed. |
| `npm run load-test:ramp` | Same mixed traffic, but arrival rate steps 10→20→50→100→200 req/s. Finds the system's breaking point — run this one while watching Grafana. |
| `npm run load-test:soak` | Same mixed traffic held flat for 15 minutes @ 40 req/s. Catches leaks/drift a short run can't — watch Grafana for anything trending up instead of holding flat. |
| `npm run load-test:spike` | 10 req/s → sudden burst to 300 req/s → back to 10 req/s. Checks whether the system recovers after an overload, not just whether it breaks. |
| `npm run load-test:multi-contention` | 2,000 users racing across 20 different hot seats (100 per seat) on 20 different screenings simultaneously. Correctness check: each of the 20 groups independently produces exactly one success. |
| `npm run load-test:checkout` | 60s @ 5 req/s driving the real Stripe checkout-session path. Requires a test-mode `STRIPE_SECRET_KEY` in `.env`. |

## Reading the results — what redlines first, and why

Run `npm run load-test:ramp` with the Grafana dashboard open
(`http://localhost:3001`, dashboard "Movie Reservation System") and watch which panel moves first
as the arrival rate steps up:

| Panel | What redlining first suggests |
|---|---|
| DB connection pool usage | Pool exhaustion — requests queueing on a DB connection, not on CPU. Fix: raise pool size or reduce per-request DB round-trips. |
| Event-loop lag | Something synchronous/blocking on the Node event loop — likely WebSocket broadcast fan-out (`ReservationBroadcastListener`) or a heavy synchronous computation. |
| HTTP p95 climbing while error rate stays flat | Queueing, not rejection — the app is falling behind but not yet shedding load. Early warning sign, not yet a failure. |
| HTTP error rate climbing | Actual rejections/timeouts — the system has passed its capacity ceiling, not just slowed down. |
| Redis hit rate dropping | Cache layer degrading under load — check `screenings.cache`/`movies.cache` TTLs and whether cache invalidation (`ReservationCacheListener`) is firing too aggressively under write load. |
| Process memory climbing steadily over 15 minutes (not sawtoothing with GC) | A leak, not normal GC behavior — only visible in `load-test:soak`, invisible in the 60s scenarios. |
| DB pool usage or p95 staying elevated after `load-test:spike`'s load has dropped back to baseline | The system didn't shed the spike cleanly — something is still working through backlog instead of catching up. |

The point of this exercise is building intuition for *why* a specific panel redlines first in
this specific system, not just confirming the app has a breaking point (it does — everything
does). Cross-reference whichever panel moves first against the table above, then go read the
code path it points at. `load-test:soak` and `load-test:spike` are read the same way, just
watching for drift-over-time and recovery-after-drop instead of a single breaking point.