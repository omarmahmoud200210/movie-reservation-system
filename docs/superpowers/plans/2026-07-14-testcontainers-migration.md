# Testcontainers Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual `docker compose -f docker-compose.test.yml up/down` step in `backend/test/` e2e tests with Testcontainers-managed Postgres and Redis containers, started/stopped automatically by Jest.

**Architecture:** A Jest `globalSetup` script starts a reusable `PostgreSqlContainer` and `RedisContainer`, runs `prisma migrate deploy` against the container's dynamic connection string, and writes the resolved connection values to a gitignored runtime env file. `jest.setup.ts` (which already runs per test file via `setupFiles`) loads that runtime file after `.env.test`, so dynamic ports override the static placeholders. `docker-compose.test.yml` is deleted since nothing else references it.

**Tech Stack:** `testcontainers` 12.0.4, `@testcontainers/postgresql` 12.0.4, `@testcontainers/redis` 12.0.4 (Node/TS, npm). Existing: Jest 30, ts-jest, dotenv, Prisma 7.

---

### Task 1: Install Testcontainers dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install packages**

Run: `npm install --save-dev testcontainers@^12.0.4 @testcontainers/postgresql@^12.0.4 @testcontainers/redis@^12.0.4`

Expected: `package.json`'s `devDependencies` gains the three entries, `package-lock.json` updates.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(test): add testcontainers dependencies"
```

---

### Task 2: Write the Testcontainers global setup script

**Files:**
- Create: `backend/test/global-setup.ts`

This script runs once before any e2e test file, in Jest's own Node process (not the test environment). It must store container handles somewhere `global-teardown.ts` can find them, and must persist the resolved connection info to a file `jest.setup.ts` (loaded per test file, in a different process) can read.

- [ ] **Step 1: Write `backend/test/global-setup.ts`**

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

const RUNTIME_ENV_PATH = path.resolve(__dirname, '.env.test.runtime');

declare global {
  // eslint-disable-next-line no-var
  var __TESTCONTAINERS__:
    | { postgres: StartedPostgreSqlContainer; redis: StartedRedisContainer }
    | undefined;
}

export default async function globalSetup(): Promise<void> {
  const postgres = await new PostgreSqlContainer('postgres:16')
    .withDatabase('movie_reservation_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .withReuse()
    .start();

  const redis = await new RedisContainer('redis:7').withReuse().start();

  global.__TESTCONTAINERS__ = { postgres, redis };

  const databaseUrl = postgres.getConnectionUri();

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const runtimeEnv = [
    `DATABASE_URL=${databaseUrl}`,
    `REDIS_CACHE_HOST=${redis.getHost()}`,
    `REDIS_CACHE_PORT=${redis.getPort()}`,
    '',
  ].join('\n');

  fs.writeFileSync(RUNTIME_ENV_PATH, runtimeEnv, 'utf-8');
}
```

- [ ] **Step 2: Commit**

```bash
git add test/global-setup.ts
git commit -m "feat(test): add testcontainers global setup for e2e tests"
```

---

### Task 3: Write the global teardown script

**Files:**
- Create: `backend/test/global-teardown.ts`

`.withReuse()` (Task 2) means Testcontainers' Ryuk reaper keeps the containers alive across Jest runs instead of stopping them at the end — that's the whole point of enabling reuse for fast local iteration. So this file intentionally does nothing to the containers. It exists only because `jest-e2e.json` (Task 5) wires a `globalTeardown` hook, and an empty async function documents that the no-op is deliberate rather than missing.

- [ ] **Step 1: Write `backend/test/global-teardown.ts`**

```typescript
export default async function globalTeardown(): Promise<void> {
  // Containers are started with .withReuse() in global-setup.ts, so they
  // intentionally stay running across test runs for fast local iteration.
  // Testcontainers' Ryuk reaper (or `docker stop`) reclaims them, not us.
}
```

- [ ] **Step 2: Commit**

```bash
git add test/global-teardown.ts
git commit -m "feat(test): add testcontainers global teardown (no-op by design)"
```

---

### Task 4: Load the runtime env file in jest.setup.ts

**Files:**
- Modify: `backend/test/jest.setup.ts`

Current content:

```typescript
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
```

- [ ] **Step 1: Add the runtime override load**

```typescript
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
dotenv.config({
  path: path.resolve(__dirname, '.env.test.runtime'),
  override: true,
});
```

- [ ] **Step 2: Commit**

```bash
git add test/jest.setup.ts
git commit -m "feat(test): override static env with testcontainers runtime values"
```

---

### Task 5: Wire globalSetup/globalTeardown into Jest config

**Files:**
- Modify: `backend/test/jest-e2e.json`

Current content:

```json
{
  "rootDir": "..",
  "moduleFileExtensions": ["js", "json", "ts"],
  "testRegex": "test/.*\\.e2e-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFiles": ["<rootDir>/test/jest.setup.ts"],
  "testEnvironment": "node",
  "testTimeout": 30000
}
```

- [ ] **Step 1: Add globalSetup/globalTeardown, raise timeout**

Container start + `prisma migrate deploy` can take longer than 30s on a cold pull, so raise `testTimeout` to 60000. This only affects individual test timeouts, not the one-time globalSetup cost.

```json
{
  "rootDir": "..",
  "moduleFileExtensions": ["js", "json", "ts"],
  "testRegex": "test/.*\\.e2e-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFiles": ["<rootDir>/test/jest.setup.ts"],
  "globalSetup": "<rootDir>/test/global-setup.ts",
  "globalTeardown": "<rootDir>/test/global-teardown.ts",
  "testEnvironment": "node",
  "testTimeout": 60000
}
```

- [ ] **Step 2: Commit**

```bash
git add test/jest-e2e.json
git commit -m "feat(test): wire testcontainers global setup/teardown into jest-e2e config"
```

---

### Task 6: Delete docker-compose.test.yml and ignore the runtime env file

**Files:**
- Delete: `backend/docker-compose.test.yml`
- Modify: `.gitignore` (repo root — `backend/` has no `.gitignore` of its own)

- [ ] **Step 1: Delete the compose file**

```bash
git rm backend/docker-compose.test.yml
```

- [ ] **Step 2: Add the runtime env file to `.gitignore`**

Current root `.gitignore`:

```
node_modules/

.env

dist/

.worktrees/
```

Add a line for the new file:

```
node_modules/

.env
backend/test/.env.test.runtime

dist/

.worktrees/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(test): remove docker-compose.test.yml, ignore testcontainers runtime env"
```

---

### Task 7: Run the e2e suite end-to-end and verify

**Files:** none (verification task)

- [ ] **Step 1: Run the e2e suite with no containers pre-started**

Run: `cd backend && npm run test:e2e`

Expected: Testcontainers pulls/starts `postgres:16` and `redis:7` (first run only — subsequent runs reuse them per `.withReuse()`), `prisma migrate deploy` output appears in the console, then all e2e spec files run and pass, matching whatever passed against the old `docker-compose.test.yml` setup.

- [ ] **Step 2: Run it a second time to confirm container reuse**

Run: `cd backend && npm run test:e2e`

Expected: no new container pull/start (Testcontainers logs indicate reuse of the existing container), suite still passes, and total run time is noticeably shorter than the first run.

- [ ] **Step 3: Confirm no leftover references to the old compose file**

Run: `grep -rn "docker-compose.test.yml" backend/ docs/ --include="*.ts" --include="*.json" --include="*.md" 2>/dev/null`

Expected: no output (Task 8 updates the two docs on `main` separately, so this grep only needs to be clean within this worktree/branch).

---

### Task 8: Update the testing design/plan docs on `main`

**Files (on the `main` branch, not this worktree):**
- Modify: `docs/superpowers/specs/2026-07-12-integration-testing-design.md`
- Modify: `docs/superpowers/plans/2026-07-12-integration-testing-implementation.md`

These two docs live on `main` and describe the original `docker compose up/down` local flow. This task is a plain doc edit done directly (not delegated), from the main worktree, not this one.

- [ ] **Step 1: Find and update the local flow section in both files**

In each file, locate the fenced block showing:

```
cd backend
docker compose -f docker-compose.test.yml up -d
npx prisma migrate deploy   # against .env.test's DATABASE_URL
npm run test:e2e
docker compose -f docker-compose.test.yml down
```

Replace it with:

```
cd backend
npm run test:e2e
```

Add a sentence near the block noting that Testcontainers now manages Postgres/Redis lifecycle automatically via Jest's `globalSetup`/`globalTeardown` (see `feat/payments-phase9` branch, `backend/test/global-setup.ts`), so the manual compose step is gone.

- [ ] **Step 2: Commit on `main`**

```bash
git add docs/superpowers/specs/2026-07-12-integration-testing-design.md docs/superpowers/plans/2026-07-12-integration-testing-implementation.md
git commit -m "docs(testing): reflect testcontainers-managed e2e infra"
```
