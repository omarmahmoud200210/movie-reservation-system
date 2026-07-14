# Testcontainers migration for e2e test infra

## Problem

`backend/test/` e2e tests currently depend on a dev manually running
`docker compose -f docker-compose.test.yml up -d` before `npm run test:e2e`,
and `down` afterward. This is an easy-to-forget manual step and isn't
CI-friendly. Replace it with Testcontainers so Jest owns the container
lifecycle.

## Scope

Test infra only (`backend/test/**`, `backend/docker-compose.test.yml`).
`backend/docker-compose.yml` (dev Redis) is untouched.

## Design

- **New devDependencies:** `testcontainers`, `@testcontainers/postgresql`,
  `@testcontainers/redis`.
- **Delete** `backend/docker-compose.test.yml` — nothing else references it.
- **`backend/test/global-setup.ts`** (new, wired via `jest-e2e.json`'s
  `globalSetup`):
  - Starts `new PostgreSqlContainer('postgres:16').withReuse()` and
    `new RedisContainer('redis:7').withReuse()`.
  - Runs `prisma migrate deploy` against the resolved Postgres connection
    string (`execSync`, with `DATABASE_URL` overridden in the child env).
  - Writes the resolved `DATABASE_URL` and `REDIS_CACHE_HOST`/
    `REDIS_CACHE_PORT` to a new gitignored file,
    `backend/test/.env.test.runtime`.
- **`backend/test/jest.setup.ts`** (edit): after loading `.env.test`, also
  load `.env.test.runtime` with `dotenv.config({ path: ..., override: true })`
  so the dynamic container ports win over the static placeholders.
- **`backend/test/global-teardown.ts`** (new): no-op body. `.withReuse(true)`
  means Testcontainers' own reaper keeps containers alive across runs rather
  than killing them at the end of a Jest run — there's no cleanup for us to
  write. (File exists so `jest-e2e.json`'s `globalTeardown` has a documented
  hook point, not because it does anything yet.)
- **`.gitignore`**: add `backend/test/.env.test.runtime`.
- **`backend/package.json`**: `test:e2e` script unchanged — Jest invokes
  `globalSetup`/`globalTeardown` automatically, so `npm run test:e2e` is
  still the only command a dev or CI runs.
- **Docs**: update the "local flow" section of
  `docs/superpowers/specs/2026-07-12-integration-testing-design.md` and
  `docs/superpowers/plans/2026-07-12-integration-testing-implementation.md`
  (both on `main`) to drop the `docker compose up/down` lines, since those
  docs describe the flow this change replaces.

## Out of scope

- CI wiring (already out of scope per the original testing plan).
- Changing how `.env.test`'s non-container values (JWT secrets, Stripe fake
  keys, etc.) are loaded — only `DATABASE_URL` and the Redis cache
  host/port become dynamic.
