# Cron Jobs (expireHolds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release seats whose 10-minute hold expired without confirmation, on a 1-minute schedule, reusing the existing `reservation.cancelled` event so cache invalidation and the WebSocket broadcast pick it up automatically.

**Architecture:** A new `ReservationsRepository.releaseExpiredHolds()` does one atomic `UPDATE ... RETURNING` (no race window). A new `ReservationsService.expireHolds()` groups the released rows by screening and emits the existing `RESERVATION_CANCELLED` event per group — zero new listener code. A thin new `CronModule` (`src/cron/`) only schedules the trigger; it holds no business logic itself.

**Tech Stack:** NestJS, `@nestjs/schedule` (already an installed dependency, unused until this phase), Prisma raw SQL (`$queryRaw` + `Prisma.sql`, matching the existing `holdSeats` pattern), Jest + `@nestjs/testing`.

**Spec:** `docs/superpowers/specs/2026-07-04-cron-jobs-design.md`

---

## Before you start

Read `docs/superpowers/specs/2026-07-04-cron-jobs-design.md` in full. Key decisions already made (don't re-litigate):
- **Only `expireHolds` this phase.** `completeScreenings` was explicitly cut — no code in the repo currently reads `ScreenStatus.COMPLETED`, verified by grep. Do not build it.
- **Reuse the existing `RESERVATION_CANCELLED` event**, not a new event or a Redis pub/sub channel (that's phase 7, not this phase). The DB status transition for an expired hold is `HELD → CANCELLED`, the same enum value user-cancel already produces — this is not a workaround, it's semantically exact.
- **No distributed locking.** The release query's `WHERE status = 'HELD' AND heldUntil < NOW()` is inherently idempotent; a second concurrent run finds nothing left to do.
- **Try/catch in the cron trigger is for log visibility only**, not correctness. Verified directly against `node_modules/cron/dist/job.js`: the underlying `cron` package already catches every tick's error and keeps the schedule running regardless — our try/catch just routes the error through NestJS's `Logger` instead of the library's raw `console.error` fallback.

---

## Task 1: Add `releaseExpiredHolds` to `ReservationsRepository`

**Files:**
- Modify: `backend/src/reservations/reservations.repository.ts`
- Modify: `backend/src/reservations/test/reservations.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/reservations/test/reservations.repository.spec.ts`, add `$queryRaw: jest.fn()` to the `mockPrisma` object (it currently only has `$transaction`, `reservation.findUnique`, `reservation.update`, `reservation.findMany` — this is a new top-level mock, not inside `mockTx`, since `releaseExpiredHolds` doesn't need a transaction):

```ts
const mockPrisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  reservation: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};
```

Then add a new `describe` block at the end of the file, right before the closing `});` of the outer `describe('ReservationsRepository', ...)`:

```ts
  describe('releaseExpiredHolds', () => {
    it('runs the atomic RETURNING update and resolves with the released rows', async () => {
      const released = [
        { id: 100, screeningId: 3, seatId: 11 },
        { id: 101, screeningId: 3, seatId: 12 },
      ];
      mockPrisma.$queryRaw.mockResolvedValue(released);
      const now = new Date('2026-07-04T12:00:00.000Z');

      await expect(repo.releaseExpiredHolds(now)).resolves.toBe(released);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('resolves with an empty array when nothing has expired', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(
        repo.releaseExpiredHolds(new Date()),
      ).resolves.toEqual([]);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest reservations.repository.spec.ts -t "releaseExpiredHolds"`
Expected: FAIL with `repo.releaseExpiredHolds is not a function`.

- [ ] **Step 3: Implement `releaseExpiredHolds`**

In `backend/src/reservations/reservations.repository.ts`, add this method right after `holdSeats` (before `findById`):

```ts
  /**
   * Atomically release every HELD reservation whose hold has expired,
   * returning exactly the rows this call changed. A single UPDATE...RETURNING
   * has no find-then-update race window, unlike a separate SELECT + UPDATE.
   * Reuses the same Prisma.sql/$queryRaw escape hatch as `holdSeats`, for the
   * same reason: Prisma's query builder can't express this.
   */
  releaseExpiredHolds(now: Date): Promise<ExpiredHold[]> {
    return this.prisma.$queryRaw<ExpiredHold[]>(Prisma.sql`
      UPDATE "reservation"
      SET status = 'CANCELLED', "heldUntil" = NULL
      WHERE status = 'HELD' AND "heldUntil" < ${now}
      RETURNING id, "screeningId", "seatId"
    `);
  }
```

Add the `ExpiredHold` type right after the existing `HoldSeatsParams` interface (near the top of the file, before the `@Injectable()` class):

```ts
export interface ExpiredHold {
  id: number;
  screeningId: number;
  seatId: number;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest reservations.repository.spec.ts`
Expected: PASS — all tests in the file, including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/reservations/reservations.repository.ts backend/src/reservations/test/reservations.repository.spec.ts
git commit -m "feat(reservations): add releaseExpiredHolds atomic bulk-release query"
```

---

## Task 2: Add `expireHolds` to `ReservationsService`

**Files:**
- Modify: `backend/src/reservations/reservations.service.ts`
- Modify: `backend/src/reservations/test/reservations.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `backend/src/reservations/test/reservations.service.spec.ts`, add `releaseExpiredHolds: jest.fn()` to `mockReservationsRepo`:

```ts
const mockReservationsRepo = {
  holdSeats: jest.fn(),
  findById: jest.fn(),
  setStatus: jest.fn(),
  findByUser: jest.fn(),
  releaseExpiredHolds: jest.fn(),
};
```

Then add a new `describe` block at the end of the file, right before the closing `});` of the outer `describe('ReservationsService', ...)` (after the existing `describe('listMine', ...)` block):

```ts
  describe('expireHolds', () => {
    it('does nothing and emits no event when nothing has expired', async () => {
      mockReservationsRepo.releaseExpiredHolds.mockResolvedValue([]);

      await service.expireHolds();

      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('emits one reservation.cancelled per screening, grouping seat ids', async () => {
      mockReservationsRepo.releaseExpiredHolds.mockResolvedValue([
        { id: 100, screeningId: 3, seatId: 11 },
        { id: 101, screeningId: 3, seatId: 12 },
        { id: 102, screeningId: 5, seatId: 20 },
      ]);

      await service.expireHolds();

      expect(mockEvents.emit).toHaveBeenCalledTimes(2);
      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CANCELLED, {
        screeningId: 3,
        seatIds: [11, 12],
      });
      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CANCELLED, {
        screeningId: 5,
        seatIds: [20],
      });
    });

    it('passes the current time to the repository', async () => {
      mockReservationsRepo.releaseExpiredHolds.mockResolvedValue([]);

      await service.expireHolds();

      expect(mockReservationsRepo.releaseExpiredHolds).toHaveBeenCalledWith(
        NOW,
      );
    });
  });
```

(`NOW` is the existing fixture at the top of the file — `jest.useFakeTimers().setSystemTime(NOW)` in `beforeEach` already makes `new Date()` inside the service return `NOW` during this test.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest reservations.service.spec.ts -t "expireHolds"`
Expected: FAIL with `service.expireHolds is not a function`.

- [ ] **Step 3: Implement `expireHolds`**

In `backend/src/reservations/reservations.service.ts`, add this method right after `reserve` (before `cancel`):

```ts
  /**
   * Release every HELD reservation whose 10-minute hold has expired. Groups
   * the released rows by screening and emits the existing
   * `reservation.cancelled` event per group — reusing the same event the
   * cache-invalidation and WebSocket-broadcast listeners already handle, so
   * an expired hold shows up live with no new listener code.
   */
  async expireHolds(): Promise<void> {
    const released = await this.reservationsRepo.releaseExpiredHolds(
      new Date(),
    );
    if (released.length === 0) return;

    const byScreening = new Map<number, number[]>();
    for (const r of released) {
      const seatIds = byScreening.get(r.screeningId) ?? [];
      seatIds.push(r.seatId);
      byScreening.set(r.screeningId, seatIds);
    }

    for (const [screeningId, seatIds] of byScreening) {
      this.events.emit(RESERVATION_CANCELLED, { screeningId, seatIds });
    }
  }
```

- [ ] **Step 4: Resolve the stale `DEFERRED(phase-6)` marker in `reserve()`**

In the same file, `reserve()` carries a comment reserving this exact seam. Now
that it's built, update it so it describes what exists instead of what's
still missing. Find:

```ts
    // DEFERRED(phase-6): the cron `expireHolds` job releases holds whose
    // heldUntil has passed and are still HELD.
    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60_000);
```

Replace with:

```ts
    // The cron `expireHolds` job (src/cron/hold-expiry.cron.ts) releases
    // holds whose heldUntil has passed and are still HELD.
    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60_000);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest reservations.service.spec.ts`
Expected: PASS — all tests in the file, including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add backend/src/reservations/reservations.service.ts backend/src/reservations/test/reservations.service.spec.ts
git commit -m "feat(reservations): add expireHolds, grouping releases by screening"
```

---

## Task 3: Export `ReservationsService` from `ReservationsModule`

**Files:**
- Modify: `backend/src/reservations/reservations.module.ts`

`ReservationsModule` currently has no `exports` array at all — `ReservationsService` is only usable inside its own module. The cron module needs to inject it, so it must be exported.

- [ ] **Step 1: Add the export**

Replace `backend/src/reservations/reservations.module.ts` in full:

```ts
import { Module } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './reservations.repository';
import { ReservationCacheListener } from './listeners/reservation-cache.listener';

/**
 * Reservations (HTTP) — hold, cancel, and list a user's seat reservations.
 * Imports ScreeningsModule for `ScreeningsRepository` (screening lookup) and
 * `ScreeningsCache` (seat-map invalidation via the event listener). Prisma and
 * the in-process event emitter are global. Exports `ReservationsService` so
 * the cron module can trigger `expireHolds` on a schedule.
 */
@Module({
  imports: [ScreeningsModule],
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    ReservationsRepository,
    ReservationCacheListener,
  ],
  exports: [ReservationsService],
})
export class ReservationsModule {}
```

- [ ] **Step 2: Verify nothing broke**

Run: `cd backend && npx jest`
Expected: PASS — every existing suite, no regressions (this is a purely additive change to the module's public surface).

- [ ] **Step 3: Commit**

```bash
git add backend/src/reservations/reservations.module.ts
git commit -m "feat(reservations): export ReservationsService for the cron module"
```

---

## Task 4: Create the `CronModule` with the `expireHolds` trigger

**Files:**
- Create: `backend/src/cron/cron.module.ts`
- Create: `backend/src/cron/hold-expiry.cron.ts`
- Create: `backend/src/cron/test/hold-expiry.cron.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/cron/test/hold-expiry.cron.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { HoldExpiryCron } from '../hold-expiry.cron';
import { ReservationsService } from '../../reservations/reservations.service';

const mockReservationsService = { expireHolds: jest.fn() };

describe('HoldExpiryCron', () => {
  let cron: HoldExpiryCron;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HoldExpiryCron,
        { provide: ReservationsService, useValue: mockReservationsService },
      ],
    }).compile();

    cron = module.get<HoldExpiryCron>(HoldExpiryCron);
  });

  it('calls ReservationsService.expireHolds', async () => {
    mockReservationsService.expireHolds.mockResolvedValue(undefined);

    await cron.handleExpireHolds();

    expect(mockReservationsService.expireHolds).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure instead of throwing', async () => {
    mockReservationsService.expireHolds.mockRejectedValue(
      new Error('DB down'),
    );

    await expect(cron.handleExpireHolds()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest hold-expiry.cron.spec.ts`
Expected: FAIL — `Cannot find module '../hold-expiry.cron'`.

- [ ] **Step 3: Implement `HoldExpiryCron`**

Create `backend/src/cron/hold-expiry.cron.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservationsService } from '../reservations/reservations.service';

/**
 * Releases HELD reservations whose 10-minute hold has expired, every minute.
 * The try/catch here is purely for log visibility, not correctness: the
 * underlying `cron` package already catches a thrown/rejected tick and keeps
 * the schedule running regardless (verified against its source) — without
 * this, a failure would still be harmless but invisible to NestJS's
 * structured Logger (the library's own fallback is a raw console.error).
 */
@Injectable()
export class HoldExpiryCron {
  private readonly logger = new Logger(HoldExpiryCron.name);

  constructor(private readonly reservationsService: ReservationsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpireHolds(): Promise<void> {
    try {
      await this.reservationsService.expireHolds();
    } catch (err) {
      this.logger.error('expireHolds tick failed', err as Error);
    }
  }

  // DEFERRED(phase-9): a payment-reconciliation cron job goes here once the
  // Payments module exists (finds timed_out payments, reconciles with Stripe).
}
```

- [ ] **Step 4: Create the module**

Create `backend/src/cron/cron.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { HoldExpiryCron } from './hold-expiry.cron';

/**
 * Scheduled jobs. Imports ReservationsModule for `ReservationsService`
 * (already exports it). This module holds no business logic of its own —
 * each file here is a thin `@Cron`-decorated trigger into an existing
 * domain service.
 */
@Module({
  imports: [ReservationsModule],
  providers: [HoldExpiryCron],
})
export class CronModule {}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest hold-expiry.cron.spec.ts`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/cron/cron.module.ts backend/src/cron/hold-expiry.cron.ts backend/src/cron/test/hold-expiry.cron.spec.ts
git commit -m "feat(cron): add CronModule with the expireHolds trigger"
```

---

## Task 5: Register `ScheduleModule` and `CronModule` in `AppModule`

**Files:**
- Modify: `backend/src/app.module.ts`

`@nestjs/schedule` is an installed dependency but its `ScheduleModule.forRoot()` has never been registered anywhere — required once, globally, for any `@Cron()` decorator in the app to actually fire.

- [ ] **Step 1: Add both imports**

Replace `backend/src/app.module.ts` in full:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailerModule } from './mailer/mailer.module';
import { AuthModule } from './auth/auth.module';
import { MoviesModule } from './movies/movies.module';
import { ScreeningsModule } from './screenings/screenings.module';
import { ReservationsModule } from './reservations/reservations.module';
import { GatewayModule } from './gateway/gateway.module';
import { CronModule } from './cron/cron.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    MailerModule,
    AuthModule,
    MoviesModule,
    ScreeningsModule,
    ReservationsModule,
    GatewayModule,
    CronModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Verify the app still boots and the full test suite passes**

Run: `cd backend && npx jest`
Expected: PASS — every existing suite plus the new cron/repository/service tests, no regressions.

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.module.ts
git commit -m "feat(cron): register ScheduleModule and CronModule in AppModule"
```

---

## Task 6: Sync `architecture.md` §6 (Scheduled Jobs) with the implementation

**Files:**
- Modify: `architecture.md`

- [ ] **Step 1: Replace the Scheduled Jobs section**

Find the `### 6. Scheduled Jobs (Cron Service)` section in `architecture.md`. It currently reads:

```markdown
### 6. Scheduled Jobs (Cron Service)

Lives inside the NestJS app using `@nestjs/schedule`.

| Job | Schedule | Responsibility |
|---|---|---|
| `expireHolds` | Every 1 min | Find held_until < NOW() → release seat → publish to Pub/Sub |
| `completeScreenings` | Every 15 min | Find screenings past starts_at + duration → mark completed |
```

Replace it with:

```markdown
### 6. Scheduled Jobs (Cron Service)

Lives inside the NestJS app using `@nestjs/schedule`. Each job is a thin
`@Cron`-decorated trigger (`src/cron/`) into an existing domain service — no
business logic lives in the cron module itself.

| Job | Schedule | Responsibility |
|---|---|---|
| `expireHolds` | Every 1 min | Atomically release HELD reservations whose `heldUntil` has passed, grouped by screening, emitting the existing `reservation.cancelled` event per group (drives cache invalidation and the WebSocket broadcast for free — no new listener). |

`completeScreenings` is intentionally not built: no code in this codebase
reads `ScreenStatus.COMPLETED` today (the "now showing" query and the
reservation-creation guard already independently gate on `startTime`
comparisons). Revisit when a real consumer appears — an admin screening list,
reviews/ratings, analytics, or phase-9 payment reconciliation.

Publishing to the Redis Pub/Sub bridge (§4) for cross-instance broadcast and
per-holder direct notification is phase 7, not this phase — `expireHolds`
instead reuses the same in-process event the WebSocket gateway already
consumes, which is sufficient for a single-instance deployment today.
```

- [ ] **Step 2: Update the Integration Wiring (phase 13) seam list**

Find the `13. **Integration Wiring**` entry in the Build Order section (near
the bottom of `architecture.md`). It currently lists known seams as:

```markdown
    - Reservations → WebSocket broadcast (phase 5, ✅ resolved when phase 5 ships)
    - Reservations → Cron hold-expiry consuming `heldUntil` (phase 6)
    - Gateway → Redis Pub/Sub `seat:hold_expired` + per-holder notification (phase 7)
    - Reservations `POST` → rate limiting (phase 8)
    - Reservations / Gateway → `HELD → CONFIRMED` / `BOOKED` on payment (phase 9)
    - Gateway `getScreeningSummary` → atomic Redis counters if load testing warrants (phase 11)
```

Replace it with (marks phase 6 resolved, matching how phase 5 was marked when
it shipped; adds the new payment-reconciliation seam this phase's
`hold-expiry.cron.ts` leaves behind):

```markdown
    - Reservations → WebSocket broadcast (phase 5, ✅ resolved when phase 5 shipped)
    - Reservations → Cron hold-expiry consuming `heldUntil` (phase 6, ✅ resolved when phase 6 shipped)
    - Gateway → Redis Pub/Sub `seat:hold_expired` + per-holder notification (phase 7)
    - Reservations `POST` → rate limiting (phase 8)
    - Reservations / Gateway → `HELD → CONFIRMED` / `BOOKED` on payment (phase 9)
    - Cron → payment reconciliation job (finds `timed_out` payments, reconciles with Stripe) (phase 9)
    - Gateway `getScreeningSummary` → atomic Redis counters if load testing warrants (phase 11)
```

- [ ] **Step 3: Verify the diff**

Run: `git diff -- architecture.md`
Expected: shows the §6 rewrite and the Integration Wiring seam-list update —
no other section changed.

- [ ] **Step 4: Commit**

```bash
git add architecture.md
git commit -m "docs: sync architecture.md Scheduled Jobs with the expireHolds-only cron phase"
```

---

## Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend test suite**

Run: `cd backend && npx jest`
Expected: every suite passes, including:
- `reservations/test/reservations.repository.spec.ts`
- `reservations/test/reservations.service.spec.ts`
- `cron/test/hold-expiry.cron.spec.ts`

- [ ] **Step 2: Type-check the whole project**

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no errors.

- [ ] **Step 3: Confirm the deferred markers are exactly as expected**

Run: `cd backend && grep -rn "DEFERRED(phase-" src`
Expected output has no `DEFERRED(phase-6)` anywhere (Task 2 Step 4 already
replaced it with a plain explanatory comment). The remaining markers should
be exactly: `reservations.service.ts` phase-9 (cancel CONFIRMED refund),
`reservations.controller.ts` phase-8 (rate limiting), `screening.gateway.ts`
phase-7 ×2, `reservation-broadcast.listener.ts` phase-9,
`screenings.service.ts` phase-11, and the new `hold-expiry.cron.ts` phase-9
(payment reconciliation).

- [ ] **Step 4: Boot the app and confirm the cron job registers without error**

Run: `cd backend && npx nest start` (stop after confirming with Ctrl+C, or
wrap with a short `timeout` command)
Expected: log lines showing `CronModule dependencies initialized` and no
errors; the app starts cleanly on its configured port.
