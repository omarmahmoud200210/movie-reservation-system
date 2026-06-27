# Movies + Screenings Modules — Implementation Plan

> **Process:** This plan is split into phases. You review it, then tell me which phase (or phases) to implement.
> Within a phase, coding sequence is **repository → service → controller → route/module wiring**.
> **Testing:** You provide the unit tests (`*.spec.ts`); I implement the code to satisfy them. Each task lists the behaviors your tests should cover so we agree on the contract first.

**Goal:** Admin-authored movie catalog and screening schedule, surfaced to users as cached read endpoints. Admins manage the full cycle via API — movies (with draft/publish), halls (auto-generated seat grids), and screenings (with hall-overlap protection). Users browse published movies (now-showing / coming-soon), open a movie's screenings, and read a screening's seat map. Seat *holding* and reservations are a later module.

**Architecture:** NestJS, repo → service → controller. All write endpoints are `ADMIN`-only via a new `RolesGuard` + `@Roles()` (reuses the JWT auth + `role` claim from the auth module). Reads are public and cached in Redis (`REDIS_CACHE`) with event-style invalidation on admin writes. Source of truth is Postgres; cache is best-effort.

**Tech Stack:** NestJS 11 · Prisma 7 (pg adapter) · `ioredis` (existing `REDIS_CACHE`) · `class-validator` · existing `JwtAuthGuard` from `auth/`.

---

## Design Decisions (locked)

| Decision | Choice |
|---|---|
| Browse rule | Two sections: **now-showing** (PUBLISHED + has a future SCHEDULED screening) and **coming-soon** (PUBLISHED + no future scheduled screening) |
| Admin scope | Full cycle via API: Movies, Screenings, Halls + Seats. (Bulk initial data still comes from a separate seed script.) |
| Publish model | `MovieStatus` enum `DRAFT` / `PUBLISHED`, default `DRAFT`. Public reads force `PUBLISHED`. |
| Seat creation | Auto-generate grid from `rows × seatsPerRow`; `Hall.capacity` derived. |
| Screening time | Single `startTime DateTime` (already in schema). End = `startTime + movie.duration`. |
| Hall overlap | **Enforced** — reject overlapping non-cancelled screenings in the same hall (409). |
| Delete safety | **Block hard delete** of any movie/hall/screening that has reservations (409). Retire via unpublish (movie) or cancel (screening). Hard delete only when zero reservations. |
| Caching | Cache movie detail, the two browse lists, and the screening seat map. Seat-map entries carry reservation-derived status. Event-driven invalidation on admin writes. |
| Pricing | `Screening.price` stays a single fixed price. Per-seat pricing deferred to the reservation module — no work here. |

---

## Endpoints (all under global prefix `api/v1`)

### Public (read)

| Method | Route | Purpose |
|---|---|---|
| GET | `/movies` | Browse → `{ nowShowing: [...], comingSoon: [...] }` (PUBLISHED only) |
| GET | `/movies/:id` | Movie detail (PUBLISHED only for users) |
| GET | `/movies/:id/screenings` | Future SCHEDULED screenings for a movie (for the selection UI) |
| GET | `/screenings/:id` | Screening detail (movie + hall + startTime + price) |
| GET | `/screenings/:id/seats` | Seat map — every seat with reservation-derived status |
| GET | `/halls/:id` | Hall + seat layout (public read; used by seat-picking UI) |

### Admin (write — `ADMIN` role)

| Method | Route | Purpose |
|---|---|---|
| POST | `/movies` | Create movie (status `DRAFT`) |
| PATCH | `/movies/:id` | Edit movie fields |
| PATCH | `/movies/:id/publish` | DRAFT → PUBLISHED |
| PATCH | `/movies/:id/unpublish` | PUBLISHED → DRAFT |
| DELETE | `/movies/:id` | Hard delete — **409** if any screening has reservations |
| GET | `/admin/movies` | List all movies incl. drafts |
| POST | `/halls` | Create hall + auto-generate seat grid |
| GET | `/halls` | List halls |
| DELETE | `/halls/:id` | **409** if any screening on the hall has reservations |
| POST | `/screenings` | Create screening (SCHEDULED) — **409** on hall overlap |
| PATCH | `/screenings/:id` | Edit screening — re-checks hall overlap |
| PATCH | `/screenings/:id/cancel` | SCHEDULED → CANCELLED |
| DELETE | `/screenings/:id` | Hard delete — **409** if it has reservations |

---

## File Structure (final state)

```
src/common/
├── guards/
│   └── roles.guard.ts            # reads @Roles metadata, checks req.user.role
└── decorators/
    └── roles.decorator.ts        # @Roles('ADMIN')

src/movies/
├── movies.module.ts
├── movies.controller.ts          # public read routes
├── movies-admin.controller.ts    # admin write routes (@Roles('ADMIN'))
├── movies.service.ts
├── movies.repository.ts          # all Prisma movie queries
├── movies.cache.ts               # cache get/set + invalidation helpers
└── dto/
    ├── create-movie.dto.ts
    └── update-movie.dto.ts

src/screenings/
├── screenings.module.ts
├── screenings.controller.ts      # public read routes
├── screenings-admin.controller.ts
├── halls-admin.controller.ts
├── screenings.service.ts
├── screenings.repository.ts
├── halls.service.ts
├── halls.repository.ts           # hall + seat grid generation
├── screenings.cache.ts           # seat_map key contract + invalidation
└── dto/
    ├── create-screening.dto.ts
    ├── update-screening.dto.ts
    └── create-hall.dto.ts
```

---

## PHASE 0 — Foundations (schema, role guard, scaffolding)

**Outcome:** Schema supports publish + correct seat uniqueness; admin role enforcement exists; both modules are wired and boot clean.

### Task 0.1 — Schema changes *(owned by you, prerequisite)*

> Same arrangement as the auth plan: you apply the schema + migrate + `prisma:generate`, then ping me.

```prisma
enum MovieStatus { DRAFT PUBLISHED }

model Movie {
  // ...
  status MovieStatus @default(DRAFT)   // ADD
}

model Seat {
  // remove the three field-level @unique on hallId/row/number
  @@unique([hallId, row, number])      // composite position uniqueness
  @@index([hallId])
}
```
**Definition of done (your side):** migration applied, client regenerated so `status` + the composite constraint exist.

### Task 0.2 — Roles guard + decorator

**Files:** `src/common/decorators/roles.decorator.ts`, `src/common/guards/roles.guard.ts`

- `@Roles(...roles: UserRole[])` sets metadata via `SetMetadata`.
- `RolesGuard` reads it with `Reflector`, compares to `req.user.role` (populated by the existing `JwtAuthGuard`). No roles metadata → allow. Missing/insufficient role → `ForbiddenException` (403).
- Admin routes are guarded with `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN')`.

**Test contract (you provide):** no `@Roles` → passes; `role=ADMIN` on an `ADMIN` route → passes; `role=USER` → 403; missing `req.user` → 403.

### Task 0.3 — Module scaffolding + wiring

- Create `MoviesModule`, `ScreeningsModule`; import both in `app.module.ts`.
- Both import `PrismaModule`; `REDIS_CACHE` already global from `RedisModule`.
- Boot app (`npm run start:dev`) → confirm clean start.
- [ ] Commit: `chore(catalog): scaffold movies + screenings modules, add roles guard`

**Phase 0 done when:** app boots, schema migrated, `@Roles('ADMIN')` blocks non-admins.

---

## PHASE 1 — Halls + Seats (admin)

**Outcome:** Admin creates a hall and its seat grid in one transaction; seats are queryable for the seat-map.

### Task 1.1 — CreateHallDto

**File:** `screenings/dto/create-hall.dto.ts`
```ts
export class CreateHallDto {
  @IsString() @MinLength(1) name: string;
  @IsInt() @Min(1) rows: number;          // e.g. 8  → rows A..H
  @IsInt() @Min(1) seatsPerRow: number;   // e.g. 12 → numbers 1..12
}
```

### Task 1.2 — HallsRepository (grid generation)

**File:** `screenings/halls.repository.ts`
- `createHallWithSeats({ name, rows, seatsPerRow })` — in a `prisma.$transaction`: create `Hall` with `capacity = rows * seatsPerRow`, then `createMany` seats with `row` = letter (A, B, …) and `number` = `'1'..'N'`.
- `findHallWithSeats(id)`, `listHalls()`, `hasReservations(hallId)` (any reservation on any screening of the hall).

**Test contract:** 8×12 creates 96 seats with rows A–H, numbers 1–12; `capacity = 96`; seat positions are unique within the hall; partial failure rolls back (no orphan hall).

### Task 1.3 — HallsService + admin controller

- `createHall`, `getHall`, `listHalls`, `deleteHall` → **409** when `hasReservations`.
- `halls-admin.controller.ts`: `POST/GET/DELETE /halls` under `@Roles('ADMIN')`; `GET /halls/:id` public.
- [ ] Commit: `feat(catalog): hall creation with auto-generated seat grid`

**Phase 1 done when:** `POST /halls {name, rows, seatsPerRow}` returns a hall whose seat grid is persisted and correct.

---

## PHASE 2 — Movies CRUD + publish (admin)

**Outcome:** Admin creates/edits movies, transitions draft↔published, lists all incl. drafts, and is blocked from destructive deletes.

### Task 2.1 — DTOs

`create-movie.dto.ts` (name, description, duration, posterImgUrl, movieType, rating, language, genre — validated). `update-movie.dto.ts` = `PartialType(CreateMovieDto)`.

### Task 2.2 — MoviesRepository

`create`, `update`, `findById`, `setStatus(id, status)`, `delete`, `listAll` (admin), `hasReservations(movieId)`.

**Test contract:** `create` defaults `status=DRAFT`; `setStatus` flips DRAFT↔PUBLISHED; `delete` throws path is guarded by service (see 2.3).

### Task 2.3 — MoviesService + admin controller

- `createMovie` (DRAFT), `updateMovie`, `publish`/`unpublish` (validate current state — e.g. publishing an already-published movie is a no-op or 400, your test contract decides), `deleteMovie` → **409** if `hasReservations`, `listAllForAdmin`.
- `movies-admin.controller.ts` under `@Roles('ADMIN')`.
- [ ] Commit: `feat(catalog): movie crud + publish/unpublish`

**Test contract:** create → DRAFT; publish → PUBLISHED; delete with reservations → 409; delete clean → 200; admin list includes drafts.

**Phase 2 done when:** full admin movie lifecycle works.

---

## PHASE 3 — Screenings CRUD (admin)

**Outcome:** Admin schedules screenings with hall-overlap protection, cancels them, and is blocked from destructive deletes.

### Task 3.1 — DTOs

`create-screening.dto.ts` (`movieId`, `hallId`, `startTime` ISO date, `price` int ≥ 0). `update-screening.dto.ts` = partial.

### Task 3.2 — ScreeningsRepository

`create`, `update`, `findById` (with movie+hall), `setStatus`, `delete`, `hasReservations(screeningId)`, and `findOverlapping(hallId, start, end, excludeId?)` — non-cancelled screenings in the hall whose `[startTime, startTime+duration)` intersects `[start, end)`.

**Test contract:** `findOverlapping` returns a collision when intervals intersect, ignores CANCELLED screenings, and excludes the screening being edited.

### Task 3.3 — ScreeningsService + admin controller

- `createScreening`: load movie (for `duration`) → compute end → `findOverlapping` → **409** if any → create SCHEDULED.
- `updateScreening`: re-run overlap check (excluding self).
- `cancelScreening` → CANCELLED. `deleteScreening` → **409** if `hasReservations`.
- `screenings-admin.controller.ts` under `@Roles('ADMIN')`.
- [ ] Commit: `feat(catalog): screening crud with hall-overlap guard`

**Test contract:** non-overlapping create → 201; overlapping → 409; overlap with a CANCELLED screening → allowed; delete with reservations → 409; cancel flips status.

**Phase 3 done when:** scheduling respects hall overlap and delete/cancel safety.

---

## PHASE 4 — Public read endpoints

**Outcome:** Users browse published movies (two sections), open movie detail + screenings, and read a screening's seat map. (Uncached first; caching added in Phase 5.)

### Task 4.1 — Movies read

- `GET /movies` → service computes:
  - **now-showing** = PUBLISHED ∧ ∃ screening `status=SCHEDULED ∧ startTime > now`
  - **coming-soon** = PUBLISHED ∧ ¬∃ such screening
  - returns `{ nowShowing, comingSoon }`.
- `GET /movies/:id` → PUBLISHED only; 404 for draft/unknown to users.
- `GET /movies/:id/screenings` → future SCHEDULED screenings (id, hall, startTime, price), ordered by `startTime`.

**Test contract:** draft movie absent from both sections and 404 on detail; published movie with a future screening is now-showing; published with none is coming-soon; past-only screenings → coming-soon.

### Task 4.2 — Screenings read + seat map

- `GET /screenings/:id` → detail (movie + hall + startTime + price); 404 if cancelled/unknown (your contract decides cancelled visibility).
- `GET /screenings/:id/seats` → all hall seats joined with reservations for this screening; map reservation status → seat status:
  - reservation `HELD` → seat `HELD`; `CONFIRMED` → `BOOKED`; none / `CANCELLED` → `AVAILABLE`.

**Test contract:** seat with a HELD reservation → HELD; CONFIRMED → BOOKED; cancelled/none → AVAILABLE; every hall seat appears exactly once.

- [ ] Commit: `feat(catalog): public movie browse + screening seat map`

**Phase 4 done when:** the browse → movie → screening → seats read path works end to end against Postgres.

---

## PHASE 5 — Caching + invalidation

**Outcome:** Hot reads served from Redis; admin writes invalidate the right keys; seat map reflects reservation-derived status.

### Cache key contract

| Key | Value | TTL | Invalidated when |
|---|---|---|---|
| `movie:{id}` | movie detail JSON | 1h | movie update / unpublish / delete |
| `movies:now_showing` | list JSON | 60s | movie publish/unpublish/delete; screening create/cancel/delete |
| `movies:coming_soon` | list JSON | 60s | same as now_showing |
| `seat_map:screening:{id}` | `[{ seatId, row, number, status }]` | 5m | screening cancel/delete; **reservation events (later module owns the push)** |

> The seat-map key + value shape is **defined here**; the reservation/WebSocket module wires real-time invalidation onto it. This module invalidates it on admin screening changes only.

### Task 5.1 — Cache helpers

- `movies.cache.ts`: `getMovie/setMovie/delMovie`, `getList/setList/delLists`.
- `screenings.cache.ts`: `getSeatMap/setSeatMap/delSeatMap`.
- Read services: cache-aside (read key → on miss load DB, set key). Write services: call the matching `del*` after a successful mutation.

**Test contract:** read populates the key on miss and serves from it on hit; publish/unpublish/delete clears `movie:{id}` + both lists; screening create/cancel/delete clears the lists (and seat map where relevant). Cache failures degrade to DB (don't throw).

- [ ] Commit: `feat(catalog): redis caching for movie detail, browse lists, seat map`

**Phase 5 done when:** repeated reads hit Redis and admin writes never serve stale catalog data.

---

## Cross-cutting notes

- **Repository owns all Prisma** — services never touch `prisma` directly (same rule as auth).
- **No business logic in controllers** — validate (DTO) → call service → return.
- **Admin guard reuse:** `role` is already in the JWT payload (`TokenService.signAccess`), so `RolesGuard` needs no DB hit.
- **Cache is best-effort:** every cached read falls back to Postgres on Redis error; the DB is the source of truth.
- **Seat-map real-time** (WebSocket push, Pub/Sub) is explicitly out of scope — this module only defines the seat-map cache key/value contract the reservation module builds on.
- **Pricing** stays per-screening fixed; per-seat pricing revisited in the reservation module.
- **Hall overlap caveat:** two screenings in the same hall at once is physically impossible and is now rejected; the same movie at the same time in *different* halls is allowed (screenings are per-hall).
