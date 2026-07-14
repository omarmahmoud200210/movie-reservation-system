# Load Testing Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Artillery-based load-testing module (`backend/load-test/`) with three scenarios
(mixed read/write baseline, hot-seat contention correctness check, ramp-to-failure) plus a seed
script and learning runbook, per `docs/superpowers/specs/2026-07-15-load-testing-design.md`.

**Architecture:** A standalone `backend/load-test/` directory (dev tooling, not `src/` application
code). `seed.ts` resets fixture data (2,500 users sharing one bcrypt hash, a 3,000-seat hall, one
screening) and writes runtime ids to `seed-output.json`. `processor.js` provides Artillery hook
functions — logging in each virtual user once via the real `/auth/login` endpoint and storing the
session cookie, picking a random available seat from a seat-map response, and deciding per-VU
whether that VU attempts a booking (~20% probability, to stay within seeded capacity and the
per-user reservation rate limit). Three YAML files declare the scenarios; `npm run load-test:*`
scripts chain a DB reset + reseed before each run so every invocation starts clean.

**Tech Stack:** `artillery` (load generation + built-in `ensure` threshold checks),
`artillery-plugin-expect` (per-response status-code assertions, used only in the contention
scenario), `dotenv` (loads `.env` for the standalone seed script — the app's own `ConfigModule`
doesn't apply outside the Nest process). All new; none are currently installed.

**Target branch:** this plan targets `main`, where the full browse → login → seat-map → reserve
flow already exists and works (`src/reservations`, `src/movies`, `src/screenings`, `src/auth`, all
confirmed present and wired). Watching the Grafana panels while `load-test:ramp` runs additionally
needs the observability stack from `docs/superpowers/plans/2026-07-12-observability-metrics-implementation.md`,
which currently lives on `feat/payments-phase9` — not required for this plan's own tasks or
verification, only for the optional "watch it in Grafana" step called out in Task 8.

---

## File Structure

**New:**
- `backend/load-test/seed.ts` — resets fixture data, writes `seed-output.json`.
- `backend/load-test/seed-output.json` — gitignored; runtime output of `seed.ts`.
- `backend/load-test/processor.js` — Artillery hook functions + a runnable self-check.
- `backend/load-test/scenarios/mixed-read-write.yml`
- `backend/load-test/scenarios/hot-seat-contention.yml`
- `backend/load-test/scenarios/ramp-to-failure.yml`
- `backend/load-test/README.md` — the learning runbook.

**Modified:**
- `backend/package.json` — add `artillery`, `artillery-plugin-expect`, `dotenv` devDependencies;
  add `load-test:seed` / `load-test:mixed` / `load-test:contention` / `load-test:ramp` scripts.
- `.gitignore` (repo root) — ignore `backend/load-test/seed-output.json`.

---

## Task 1: Dependencies and directory skeleton

**Files:**
- Modify: `backend/package.json`
- Modify: `.gitignore`
- Create: `backend/load-test/` (directory), `backend/load-test/scenarios/` (directory)

- [ ] **Step 1: Add devDependencies**

In `backend/package.json`, add to `devDependencies` (keep alphabetical with the existing list):

```json
    "artillery": "^2.0.33",
    "artillery-plugin-expect": "^2.27.0",
```

and:

```json
    "dotenv": "^17.4.2",
```

placed alphabetically among the existing entries (after `"@types/supertest"` for the first two,
after `"eslint-plugin-prettier"` for `dotenv` — match alphabetical order with what's already
there).

- [ ] **Step 2: Add the npm scripts**

In `backend/package.json`, in the `scripts` block, add these four entries (after `db:reset`):

```json
    "load-test:seed": "prisma migrate reset --force --skip-seed && ts-node -r dotenv/config load-test/seed.ts",
    "load-test:mixed": "npm run load-test:seed && artillery run load-test/scenarios/mixed-read-write.yml",
    "load-test:contention": "npm run load-test:seed && artillery run load-test/scenarios/hot-seat-contention.yml",
    "load-test:ramp": "npm run load-test:seed && artillery run load-test/scenarios/ramp-to-failure.yml"
```

Note the `--skip-seed` flag on `prisma migrate reset` — `backend/prisma/seed.ts` does not exist
on this branch (confirmed by search), so the bare `prisma db seed` step that `migrate reset` runs
automatically by default would fail. `--skip-seed` avoids that entirely; `ts-node .../seed.ts`
right after it does the actual seeding this module needs.

- [ ] **Step 3: Install**

Run: `cd backend && npm install`
Expected: exits 0, `package-lock.json` updates to include `artillery`, `artillery-plugin-expect`,
and `dotenv`.

- [ ] **Step 4: Create the directory skeleton**

```bash
mkdir -p backend/load-test/scenarios
```

- [ ] **Step 5: Ignore the runtime seed-output file**

Add this line to the repo-root `.gitignore` (it currently has `node_modules/`, `.env`, `dist/`,
`.worktrees/`):

```
backend/load-test/seed-output.json
```

- [ ] **Step 6: Verify the install**

Run: `cd backend && npx artillery version`
Expected: prints a version string starting with `2.` — confirms the binary is on PATH via
`node_modules/.bin`.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json .gitignore
git commit -m "chore(load-test): add artillery + dotenv devDependencies, npm scripts"
```

---

## Task 2: Seed script

**Files:**
- Create: `backend/load-test/seed.ts`

- [ ] **Step 1: Write the seed script**

```typescript
// backend/load-test/seed.ts
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { PrismaClient, MovieStatus, ScreenStatus, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const USER_COUNT = 2500;
const SEAT_COUNT = 3000;
const SEATS_PER_ROW = 50;
const LOAD_TEST_PASSWORD = 'LoadTest123!';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log(`Hashing shared password for ${USER_COUNT} test users...`);
  const passwordHash = await bcrypt.hash(LOAD_TEST_PASSWORD, 10);

  console.log(`Creating ${USER_COUNT} test users...`);
  await prisma.user.createMany({
    data: Array.from({ length: USER_COUNT }, (_, i) => ({
      name: `Load Test User ${i}`,
      email: `loadtest${i}@test.local`,
      password: passwordHash,
      emailVerified: true,
      role: UserRole.USER,
    })),
  });

  console.log('Creating load-test hall...');
  const hall = await prisma.hall.create({
    data: { name: 'Load Test Hall', capacity: SEAT_COUNT },
  });

  console.log(`Creating ${SEAT_COUNT} seats...`);
  await prisma.seat.createMany({
    data: Array.from({ length: SEAT_COUNT }, (_, i) => ({
      hallId: hall.id,
      row: `R${Math.floor(i / SEATS_PER_ROW)}`,
      number: `${i % SEATS_PER_ROW}`,
    })),
  });

  console.log('Creating load-test movie...');
  const movie = await prisma.movie.create({
    data: {
      name: 'Load Test Movie',
      description: 'Seeded fixture for load testing — not a real movie.',
      duration: 120,
      posterImgUrl: 'https://example.com/load-test-poster.jpg',
      movieType: '2D',
      rating: 0,
      language: 'en',
      genre: 'Test',
      status: MovieStatus.PUBLISHED,
    },
  });

  console.log('Creating load-test screening...');
  const screening = await prisma.screening.create({
    data: {
      hallId: hall.id,
      movieId: movie.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
      status: ScreenStatus.SCHEDULED,
      price: 1000,
    },
  });

  const firstSeat = await prisma.seat.findFirstOrThrow({
    where: { hallId: hall.id },
    orderBy: { id: 'asc' },
  });

  const output = { screeningId: screening.id, hotSeatId: firstSeat.id };
  fs.writeFileSync(
    path.join(__dirname, 'seed-output.json'),
    JSON.stringify(output, null, 2),
  );

  console.log('Seed complete:', output);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against a live local DB**

Prerequisite: Postgres must be up (`cd backend && npm run docker:up:dev`) — no need to apply
migrations separately first, since `npm run load-test:seed` itself runs `prisma migrate reset`
before `seed.ts`, which drops, recreates, and re-migrates the database from scratch.

Run: `cd backend && npm run load-test:seed`
Expected: console prints the five "Creating ..." lines in order, then
`Seed complete: { screeningId: <number>, hotSeatId: <number> }`, exits 0.

- [ ] **Step 3: Verify the output file and row counts**

Run: `cat backend/load-test/seed-output.json`
Expected: valid JSON, e.g. `{ "screeningId": 1, "hotSeatId": 1 }`.

Run this one-off count check:
```bash
cd backend && node -e "
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
Promise.all([
  prisma.user.count(),
  prisma.seat.count(),
  prisma.screening.count(),
]).then(([users, seats, screenings]) => {
  console.log({ users, seats, screenings });
  process.exit(0);
});
"
```
Expected: `{ users: 2500, seats: 3000, screenings: 1 }`.

- [ ] **Step 4: Commit**

```bash
git add backend/load-test/seed.ts
git commit -m "feat(load-test): add fixture seed script"
```

(`seed-output.json` is gitignored from Task 1 and will not be staged — confirm with
`git status` that it doesn't appear before committing.)

---

## Task 3: Artillery processor hooks

**Files:**
- Create: `backend/load-test/processor.js`

- [ ] **Step 1: Write the processor**

```javascript
// backend/load-test/processor.js
'use strict';

const fs = require('fs');
const path = require('path');

const USER_COUNT = 2500;
const BOOKING_PROBABILITY = 0.2;
const LOAD_TEST_PASSWORD = 'LoadTest123!';
const BASE_URL = process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000';

function loadSeedOutput() {
  const seedPath = path.join(__dirname, 'seed-output.json');
  return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
}

async function loginBeforeScenario(context, ee, next) {
  const seedOutput = loadSeedOutput();
  context.vars.screeningId = seedOutput.screeningId;
  context.vars.hotSeatId = seedOutput.hotSeatId;
  context.vars.willBook = Math.random() < BOOKING_PROBABILITY;

  const userIndex = Math.floor(Math.random() * USER_COUNT);
  const email = `loadtest${userIndex}@test.local`;

  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: LOAD_TEST_PASSWORD }),
  });

  if (!res.ok) {
    return next(new Error(`load-test login failed for ${email}: ${res.status}`));
  }

  const setCookies = res.headers.getSetCookie();
  context.vars.authCookie = setCookies.map((c) => c.split(';')[0]).join('; ');

  return next();
}

function pickAvailableSeat(requestParams, response, context, ee, next) {
  const seats = JSON.parse(response.body);
  const available = seats.filter((s) => s.status === 'AVAILABLE');
  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)];
    context.vars.pickedSeatId = pick.seatId;
  }
  return next();
}

module.exports = { loginBeforeScenario, pickAvailableSeat };

if (require.main === module) {
  // ponytail: smallest runnable check for the branching logic here — this file
  // isn't application code under src/, so it's exempt from the Jest convention,
  // but the filtering/picking logic still deserves one assert-based self-check.
  const assert = require('assert');

  const mixed = [
    { seatId: 1, row: 'A', number: '1', status: 'BOOKED' },
    { seatId: 2, row: 'A', number: '2', status: 'AVAILABLE' },
  ];
  const ctx1 = { vars: {} };
  pickAvailableSeat(null, { body: JSON.stringify(mixed) }, ctx1, null, () => {});
  assert.strictEqual(ctx1.vars.pickedSeatId, 2, 'picks the only AVAILABLE seat');

  const allBooked = [{ seatId: 1, row: 'A', number: '1', status: 'BOOKED' }];
  const ctx2 = { vars: {} };
  pickAvailableSeat(null, { body: JSON.stringify(allBooked) }, ctx2, null, () => {});
  assert.strictEqual(
    ctx2.vars.pickedSeatId,
    undefined,
    'leaves pickedSeatId unset when nothing is available',
  );

  console.log('processor.js self-check passed');
}
```

- [ ] **Step 2: Run the self-check**

Run: `node backend/load-test/processor.js`
Expected: `processor.js self-check passed`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/load-test/processor.js
git commit -m "feat(load-test): add Artillery processor hooks (login, seat picking)"
```

---

## Task 4: Mixed read/write scenario

**Files:**
- Create: `backend/load-test/scenarios/mixed-read-write.yml`

- [ ] **Step 1: Write the scenario**

```yaml
# backend/load-test/scenarios/mixed-read-write.yml
config:
  target: "http://localhost:3000"
  processor: "./processor.js"
  phases:
    - duration: 60
      arrivalRate: 50
      name: "Mixed read/write baseline"
  ensure:
    p95: 500
    maxErrorRate: 1

scenarios:
  - name: "Browse and maybe book"
    beforeScenario: "loginBeforeScenario"
    flow:
      - get:
          url: "/api/v1/movies"
          headers:
            Cookie: "{{ authCookie }}"
      - get:
          url: "/api/v1/screenings/{{ screeningId }}/seats"
          headers:
            Cookie: "{{ authCookie }}"
          afterResponse: "pickAvailableSeat"
      - post:
          url: "/api/v1/reservations"
          ifTrue: "willBook"
          headers:
            Cookie: "{{ authCookie }}"
          json:
            screeningId: "{{ screeningId }}"
            seatIds: ["{{ pickedSeatId }}"]
```

- [ ] **Step 2: Validate the YAML parses**

Run: `cd backend && npx artillery run --dry-run load-test/scenarios/mixed-read-write.yml`
Expected: prints the parsed phase/scenario summary, no YAML/schema errors, exits 0. (`--dry-run`
validates and prints the plan without sending traffic — no live app needed for this step.)

- [ ] **Step 3: Commit**

```bash
git add backend/load-test/scenarios/mixed-read-write.yml
git commit -m "feat(load-test): add mixed read/write scenario"
```

---

## Task 5: Hot-seat contention scenario

**Files:**
- Create: `backend/load-test/scenarios/hot-seat-contention.yml`

- [ ] **Step 1: Write the scenario**

```yaml
# backend/load-test/scenarios/hot-seat-contention.yml
config:
  target: "http://localhost:3000"
  processor: "./processor.js"
  plugins:
    expect: {}
  phases:
    - duration: 1
      arrivalCount: 100
      name: "Hot seat contention"

scenarios:
  - name: "Race for the same seat"
    beforeScenario: "loginBeforeScenario"
    flow:
      - post:
          url: "/api/v1/reservations"
          headers:
            Cookie: "{{ authCookie }}"
          json:
            screeningId: "{{ screeningId }}"
            seatIds: ["{{ hotSeatId }}"]
          expect:
            - statusCode: [201, 409]
```

The per-response `expect` here only asserts every response is a 201 or a 409 — no unexpected 5xx
or 429 noise (each of the 100 users books exactly once, well under the 3/60s per-user rate limit).
It does **not** assert the aggregate "exactly one 201" outcome — Artillery's `expect` plugin checks
each response independently, not counts across the run. That aggregate check happens in Task 8's
verification step, by parsing Artillery's JSON summary output after the run.

- [ ] **Step 2: Validate the YAML parses**

Run: `cd backend && npx artillery run --dry-run load-test/scenarios/hot-seat-contention.yml`
Expected: prints the parsed plan, no errors, exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/load-test/scenarios/hot-seat-contention.yml
git commit -m "feat(load-test): add hot-seat contention scenario"
```

---

## Task 6: Ramp-to-failure scenario

**Files:**
- Create: `backend/load-test/scenarios/ramp-to-failure.yml`

- [ ] **Step 1: Write the scenario**

```yaml
# backend/load-test/scenarios/ramp-to-failure.yml
config:
  target: "http://localhost:3000"
  processor: "./processor.js"
  phases:
    - duration: 30
      arrivalRate: 10
      name: "10 req/s"
    - duration: 30
      arrivalRate: 20
      name: "20 req/s"
    - duration: 30
      arrivalRate: 50
      name: "50 req/s"
    - duration: 30
      arrivalRate: 100
      name: "100 req/s"
    - duration: 30
      arrivalRate: 200
      name: "200 req/s"
  ensure:
    p95: 500

scenarios:
  - name: "Browse and maybe book (ramping)"
    beforeScenario: "loginBeforeScenario"
    flow:
      - get:
          url: "/api/v1/movies"
          headers:
            Cookie: "{{ authCookie }}"
      - get:
          url: "/api/v1/screenings/{{ screeningId }}/seats"
          headers:
            Cookie: "{{ authCookie }}"
          afterResponse: "pickAvailableSeat"
      - post:
          url: "/api/v1/reservations"
          ifTrue: "willBook"
          headers:
            Cookie: "{{ authCookie }}"
          json:
            screeningId: "{{ screeningId }}"
            seatIds: ["{{ pickedSeatId }}"]
```

The `ensure.p95: 500` threshold is declared but expected to fail at some phase — per the design
spec, that failure point is the deliverable of this scenario, not a bug to fix. No error-rate
threshold is declared here (unlike `mixed-read-write.yml`); a rising error rate under ramping load
is an expected signal to observe, not a gate to enforce.

- [ ] **Step 2: Validate the YAML parses**

Run: `cd backend && npx artillery run --dry-run load-test/scenarios/ramp-to-failure.yml`
Expected: prints the parsed plan (5 phases), no errors, exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/load-test/scenarios/ramp-to-failure.yml
git commit -m "feat(load-test): add ramp-to-failure scenario"
```

---

## Task 7: Learning runbook

**Files:**
- Create: `backend/load-test/README.md`

- [ ] **Step 1: Write the README**

```markdown
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

The point of this exercise is building intuition for *why* a specific panel redlines first in
this specific system, not just confirming the app has a breaking point (it does — everything
does). Cross-reference whichever panel moves first against the table above, then go read the
code path it points at.
```

- [ ] **Step 2: Commit**

```bash
git add backend/load-test/README.md
git commit -m "docs(load-test): add learning runbook"
```

---

## Task 8: Full verification pass

**Files:** none — verification only.

- [ ] **Step 1: Bring up dependencies**

```bash
cd backend
npm run docker:up:dev
npm run start:dev &   # or a separate terminal — the app must stay running for the rest of this task
```

Wait for the app to log its "Nest application successfully started" line before continuing.

- [ ] **Step 2: Run the mixed read/write scenario and check thresholds**

Run: `cd backend && npm run load-test:mixed`
Expected: Artillery prints a summary report; the run exits 0 (both `ensure` thresholds — p95 < 500ms
and error rate < 1% — passed). If it exits non-zero, read the printed summary to see which
threshold failed and by how much before treating this as a real regression.

- [ ] **Step 3: Run the contention scenario and verify the aggregate outcome**

Run:
```bash
cd backend && npm run load-test:seed && npx artillery run --output /tmp/contention-report.json load-test/scenarios/hot-seat-contention.yml
node -e "
const r = require('/tmp/contention-report.json');
const codes = r.aggregate.counters;
console.log({ 'http.codes.201': codes['http.codes.201'] || 0, 'http.codes.409': codes['http.codes.409'] || 0 });
"
```
Expected: `{ 'http.codes.201': 1, 'http.codes.409': 99 }`. If the 201 count is anything other than
1, the reservation locking design has a race — this is the scenario that exists specifically to
catch that, so treat any deviation as a real bug, not test flakiness.

- [ ] **Step 4: Run the ramp-to-failure scenario**

If the observability stack (from the Task 8 dependency note above) is available:
```bash
docker compose -f backend/docker-compose.monitoring.yml up -d
```
Open `http://localhost:3001` (Grafana) and the "Movie Reservation System" dashboard, then run:

Run: `cd backend && npm run load-test:ramp`

While it runs, watch the Grafana panels. Expected: p95 latency climbs across phases and the
`ensure.p95: 500` threshold fails at some phase — this is expected, not a bug (see Task 6). Note
which panel visibly moves first; cross-reference `backend/load-test/README.md`'s table.

If the observability stack isn't available yet, run the same command without Grafana open — the
Artillery summary report alone still shows the per-phase latency degradation.

- [ ] **Step 5: Report back**

Summarize: did all three scenarios run to completion, did the mixed-read-write and contention
scenarios produce the expected pass/aggregate-outcome, and (if Grafana was available) which panel
redlined first during the ramp — this is the same kind of manual smoke-test report the
observability plan's Task 8 used, since none of this is (or should be) covered by `npx jest`.
