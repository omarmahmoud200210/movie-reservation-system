# Load Testing Module

I did this simulation to learn how as engineers we build scalable systems that survive in production.

## Overview

This module uses [Artillery](https://www.artillery.io/) to simulate real user traffic against the Movie Reservation System backend. The goal is to answer questions that unit tests and integration tests can't:

- **Does the database blow up when 100 users race for the same seat?**
- **At what request rate does the API start dropping requests?**
- **Does memory leak when the server runs under load for 15 minutes straight?**
- **Can the system recover after a sudden traffic spike, or does it stay degraded?**

### How It Works

```
seed.ts  ──►  Creates 2,500 test users + screenings in the DB
                         │
                         ▼
               seed-output.json  (screening IDs, seat IDs)
                         │
                         ▼
processor.js  ──►  Reads seed data, provides hooks to Artillery:
                   • loginBeforeScenario   – authenticates each virtual user
                   • pickAvailableSeat     – randomly picks an available seat from an API response
                   • pickHotScreeningBeforeScenario – round-robins VUs across 20 screenings
                   • logContentionResult   – logs race condition results to NDJSON
                   • captureReservationId  – captures reservation ID for chained requests
                         │
                         ▼
scenarios/*.yml  ──►  YAML files that define load shapes + request flows
                      Artillery reads the processor hooks by name
```

### File Structure

```
load-test/
├── README.md                  ← You are here
├── seed.ts                    ← Prisma script that creates test data (2,500 users, screenings, seats)
├── seed-output.json           ← IDs produced by the seed script, consumed by processor.js
├── processor.js               ← Custom Artillery hooks (auth, seat picking, result logging)
├── bulk-seed-sql.ts           ← Runner for the millions-of-rows dataset (see section below)
├── bulk-seed-analyze.ts       ← EXPLAIN (ANALYZE, BUFFERS) probes against the large dataset
├── sql/                       ← Pure-SQL generation scripts for the large dataset
│   ├── 00-reset.sql
│   ├── 01-refund-policy.sql … 09-payments-failed.sql
│   └── 10-analyze.sql
└── scenarios/
    ├── mixed-read-write.yml       ← Scenario 1: Baseline mixed traffic
    ├── hot-seat-contention.yml    ← Scenario 2: 100 users → 1 seat
    ├── multi-hot-contention.yml   ← Scenario 3: 2,000 users → 20 seats
    ├── checkout-payment.yml       ← Scenario 4: Full reserve + pay flow
    ├── ramp-to-failure.yml        ← Scenario 5: Find the breaking point
    ├── soak-mixed.yml             ← Scenario 6: 15-minute endurance run
    └── spike-recovery.yml         ← Scenario 7: Traffic bomb + recovery
```

---

## The 7 Scenarios

### Scenario 1 — Mixed Read-Write (Baseline)

**File:** `scenarios/mixed-read-write.yml`
**Command:** `npm run load-test:mixed`

| Property | Value |
|----------|-------|
| Load | 50 req/s constant |
| Duration | 60 seconds |
| Pass criteria | p95 < 500ms, error rate < 1% |

**What it does:**
Each virtual user logs in, browses the movie list, checks available seats for a screening, and has a 20% chance of making a reservation. This simulates normal production traffic where most users browse and a minority actually books.

**Why it matters:**
This is the sanity check — if this fails, nothing else matters. It establishes a performance baseline that all other scenarios compare against.

**Flow:**
```
Login → GET /movies → GET /screenings/{id}/seats → (20% chance) POST /reservations
```

---

### Scenario 2 — Hot Seat Contention

**File:** `scenarios/hot-seat-contention.yml`
**Command:** `npm run load-test:contention`

| Property | Value |
|----------|-------|
| Load | 100 users arrive simultaneously |
| Duration | ~1 second |
| Pass criteria | Exactly 1 gets `201`, the rest get `409` |

**What it does:**
100 users all try to reserve the **exact same seat** on the **exact same screening** at the same instant. This is a pure concurrency test.

**Why it matters:**
This tests whether your database locking strategy actually prevents double-booking. If 2 or more users get `201 Created`, you have a race condition bug — two people "own" the same seat. The correct result is exactly 1 winner (`201`) and 99 losers (`409 Conflict`).

**Flow:**
```
Login → POST /reservations (all targeting the same screeningId + hotSeatId)
```

---

### Scenario 3 — Multi-Hot Contention

**File:** `scenarios/multi-hot-contention.yml`
**Command:** `npm run load-test:multi-contention`

| Property | Value |
|----------|-------|
| Load | 2,000 users arrive simultaneously |
| Duration | ~1 second |
| Pass criteria | Each of 20 groups has exactly 1 winner |

**What it does:**
Scales up Scenario 2 to 2,000 users across 20 different screenings. Users are round-robined so each screening gets ~100 concurrent attempts at one hot seat. Results are logged to `multi-contention-results.ndjson`.

**Why it matters:**
Single-row locking (Scenario 2) is one thing — 20 independent lock races happening in parallel is another. This tests whether your database can handle contention on **multiple rows simultaneously** without deadlocks, timeouts, or lock escalation issues.

**Flow:**
```
Login → Round-robin pick screening → POST /reservations (targeting that screening's hot seat)
```

---

### Scenario 4 — Checkout Payment

**File:** `scenarios/checkout-payment.yml`
**Command:** `npm run load-test:checkout`

| Property | Value |
|----------|-------|
| Load | 5 req/s constant |
| Duration | 60 seconds |
| Pass criteria | Error rate < 1% |

**What it does:**
Each user goes through the **full purchase flow**: check available seats → reserve a seat → create a Stripe checkout session. This chains 3 dependent API calls where each step's output feeds the next.

**Why it matters:**
This is the deepest flow in the app. It tests that reservation IDs correctly pass through to the payment system, that Stripe's API doesn't become a bottleneck, and that the full transactional chain holds up. The low rate (5 req/s) is intentional — this is about **correctness of the chain**, not raw throughput.

**Flow:**
```
Login → GET /screenings/{id}/seats → POST /reservations → POST /payments/checkout-session
```

> **Note:** Requires a test-mode `STRIPE_SECRET_KEY` in `.env`.

---

### Scenario 5 — Ramp to Failure

**File:** `scenarios/ramp-to-failure.yml`
**Command:** `npm run load-test:ramp`

| Property | Value |
|----------|-------|
| Load | 10 → 20 → 50 → 100 → 200 req/s (step increase) |
| Duration | 2.5 minutes (30s per step) |
| Pass criteria | p95 < 500ms |

**What it does:**
Runs the same browse-and-maybe-book flow as Scenario 1, but the arrival rate **increases every 30 seconds** in 5 steps. The goal is to find where the system starts to degrade.

**Why it matters:**
Every system has a breaking point. This scenario finds yours. You watch which metric degrades first:
- **p95 latency climbing** → system is queueing, not yet rejecting
- **Error rate climbing** → system has passed its capacity ceiling
- **DB pool exhausted** → bottleneck is database connections, not CPU
- **Event loop lag** → something synchronous is blocking Node.js

The step where things break tells you your max sustainable throughput — essential for capacity planning and knowing how many servers you need in production.

**Flow:**
```
Login → GET /movies → GET /screenings/{id}/seats → (20% chance) POST /reservations
```

---

### Scenario 6 — Soak Mixed (Endurance)

**File:** `scenarios/soak-mixed.yml`
**Command:** `npm run load-test:soak`

| Property | Value |
|----------|-------|
| Load | 40 req/s constant |
| Duration | 15 minutes |
| Pass criteria | Error rate < 1% |

**What it does:**
Same flow as Scenario 1, but runs for **15 minutes** instead of 1 minute. The load is moderate and constant — this isn't about peak stress, it's about sustained operation.

**Why it matters:**
Some bugs only appear over time:
- **Memory leaks** — heap grows steadily instead of sawtoothing with garbage collection
- **Connection pool exhaustion** — Prisma connections are checked out but never returned
- **Gradual latency creep** — caches expire, GC pauses get longer, write-ahead logs grow

If p99 is 100ms at minute 1 but 2,000ms at minute 15, you have a leak somewhere. A 60-second test would never catch this.

**Flow:**
```
Login → GET /movies → GET /screenings/{id}/seats → (20% chance) POST /reservations
```

---

### Scenario 7 — Spike Recovery

**File:** `scenarios/spike-recovery.yml`
**Command:** `npm run load-test:spike`

| Property | Value |
|----------|-------|
| Load | 10 req/s → 300 req/s → 10 req/s |
| Duration | ~2 minutes (30s + 20s + 60s) |
| Pass criteria | Recovery phase returns to baseline performance |

**What it does:**
Three phases:
1. **Baseline** (30s at 10 req/s) — establish normal performance
2. **Spike** (20s at 300 req/s) — slam the system with 30x normal traffic
3. **Recovery** (60s at 10 req/s) — drop back to baseline and see if it recovers

**Why it matters:**
The important measurement isn't whether the system survives the spike (it likely won't fully) — it's whether **latency and error rates return to normal after the spike ends**. If the recovery phase is still degraded, it means:
- Connection pools got stuck and didn't drain
- Request queues backed up and never cleared
- The Node.js event loop got starved and didn't recover

A system that breaks under spike but recovers cleanly is production-worthy. A system that stays broken after the spike passes is dangerous.

**Flow:**
```
Login → GET /movies → GET /screenings/{id}/seats → (20% chance) POST /reservations
```

---

## How the Scenarios Relate to Each Other

Think of them as layers of confidence you build in order:

```
Layer 1 — Correctness:   hot-seat-contention → multi-hot-contention → checkout-payment
Layer 2 — Capacity:      mixed-read-write → ramp-to-failure
Layer 3 — Reliability:   soak-mixed → spike-recovery
```

No point stress-testing capacity if your concurrency control is broken. No point running a 15-minute soak if the system can't handle 1 minute of normal traffic.

## Bulk Dataset (Millions of Rows)

The load-test scenarios above use the small `seed.ts` dataset (2,500 users). To
practice database scaling decisions, use the **pure-SQL bulk loader** to build a
~10M-row reservation table (~3M payments) with valid foreign keys.

### How it works

All data generation lives in `sql/` as plain SQL using `generate_series()` +
`random()`. Each file is one statement, numbered in FK load order. The runner
`bulk-seed-sql.ts` just connects, calls `setseed(0.42)` for reproducible data,
executes the files in order, and prints final counts.

The only knob is screening count (`__SCREENINGS__` token in `06-screenings.sql`):
reservations are exactly one row per (screening, seat), so ~67,000 screenings
≈ 10M reservations.

### Commands

```bash
npm run db:bulk-seed -- --smoke              # ~100k reservations, quick sanity run
npm run db:bulk-seed -- --clean              # TRUNCATE all tables, then load ~10M
npm run db:bulk-seed -- --reservations 10000 # target a specific reservation count
npm run db:bulk-seed:analyze                 # EXPLAIN ANALYZE on the app's hot queries
```

### Learning workflow

```
1. npm run db:bulk-seed -- --clean          # load ~10M rows
2. npm run db:bulk-seed:analyze             # see which queries seq-scan vs use indexes
3. Add/move an index (see scalability gaps)
4. npm run db:bulk-seed -- --clean          # reload the same dataset (fixed seed)
5. npm run db:bulk-seed:analyze             # compare before/after
```

> **Warning:** `--clean` destroys all data in the database. Do not run it
> against a database you care about.

## Prerequisites

Before running any scenario:

1. Postgres and Redis are running: `npm run docker:up:dev`
2. The app is running: `npm run start:dev`
3. The database is seeded (each `load-test:*` script handles this automatically)

> **Warning:** Each load-test script resets and reseeds the database before running. **This destroys existing local dev data.** Do not run against a database you care about.
