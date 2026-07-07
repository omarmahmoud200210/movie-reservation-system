# Payments (Phase 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Stripe Checkout payment for a single-seat HELD reservation, webhook-driven confirmation,
refund-on-cancel, a reconciliation cron, and a payment-abuse lockout — per
`docs/superpowers/specs/2026-07-06-payment-design.md`.

**Architecture:** New `PaymentsModule` (controller/service/repository) alongside a single-seat refactor
of the existing `ReservationsModule`. `PaymentsModule` and `ReservationsModule` depend on each other
(`Payments` needs to look up/extend/confirm reservations; `Reservations.cancel()` needs to trigger a
refund for a `CONFIRMED` row) — resolved with NestJS `forwardRef()` on both sides, a first-class pattern
for exactly this case, not a workaround. `PaymentAbuseService` lives in `RedisModule` (global, like
`RateLimiterService`) so no import is needed to use it.

**Tech Stack:** NestJS, Prisma/PostgreSQL, `stripe` SDK (`^22.2.2`, already a dependency), Redis
(`ioredis` via the existing `RedisCache`/`RateLimiterService` pattern), Jest.

**Deviations from the spec doc, decided during planning (see inline notes at each task):**
1. `PaymentAbuseService` lives in `src/redis/` (matches where `RateLimiterService` already lives), not a
   new `src/common/services/` directory.
2. `ReservationsService.cancel()`'s `CONFIRMED → refund` branch needs `PaymentsService` injected via
   `forwardRef()` — the spec's "no circular dependency" claim only holds for the `GET status` endpoint
   placement decision, not for cancel-with-refund. `forwardRef()` is used, not a route split.
3. RefundPolicy seed rows go in a new `prisma/seed.ts` (the `prisma:seed` / `db:reset` npm scripts already
   expect one — it just doesn't exist yet), not embedded as raw SQL in a migration.
4. Stripe client is instantiated directly as a class field (`new Stripe(...)`), matching how
   `MailerService` instantiates `nodemailer` directly — no DI factory/token wrapper.

---

## ⚠️ Before starting: things only you can do

**1. Verify your Stripe account can actually charge in EGP.** Stripe's list of supported countries for
receiving payouts and its list of presentment currencies you can *charge in* are different things, and
don't always overlap for every account. In the Stripe Dashboard (test mode is fine for now): **Settings →
Business settings → your account's supported currencies**, or just try creating a test Checkout Session
in EGP via the dashboard's payment links tool. If EGP isn't chargeable on your account, tell me before
Task 9 — the fix is small (e.g. settle in USD, display EGP) but changes the `currency` constant and a test
fixture.

**2. Register the webhook endpoint** (needed before Task 10 is testable end-to-end, not before starting):
Stripe Dashboard → Developers → Webhooks → Add endpoint. URL: `<your ngrok/tunnel URL or deployed
URL>/api/v1/payments/webhook`. For local dev, `stripe listen --forward-to
localhost:3000/api/v1/payments/webhook` (Stripe CLI) is easier than a real dashboard endpoint + tunnel —
it prints a `whsec_...` for you directly. Either way, put the signing secret in `STRIPE_WEBHOOK_SECRET` in
`.env`. Subscribe to (or forward, if using the CLI) at least: `checkout.session.completed`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.dispute.created`.

**3. Confirm `.env` has real test-mode keys.** `.env.example` has placeholder `sk_test_...`/`whsec_...` —
your actual `backend/.env` needs real values from Stripe Dashboard → Developers → API keys (test mode
toggle on). No dashboard action needed if already done.

---

## File Structure

**New:**
- `backend/prisma/seed.ts` — RefundPolicy rows.
- `backend/src/redis/payment-abuse.service.ts` — lockout counter (Redis-backed).
- `backend/src/redis/test/payment-abuse.service.spec.ts`
- `backend/src/payments/payments.module.ts`
- `backend/src/payments/payments.controller.ts`
- `backend/src/payments/payments.service.ts`
- `backend/src/payments/payments.repository.ts`
- `backend/src/payments/dto/create-checkout-session.dto.ts`
- `backend/src/payments/test/payments.repository.spec.ts`
- `backend/src/payments/test/payments.service.spec.ts`
- `backend/src/payments/test/payments.controller.spec.ts`

**Modified:**
- `backend/prisma/schema.prisma` — `PaymentStatus` enum expansion (7 values).
- `backend/package.json` — add `"prisma": { "seed": "ts-node prisma/seed.ts" }`.
- `backend/src/reservations/dto/create-reservation.dto.ts` — `seatIds: number[]` → `seatId: number`.
- `backend/src/reservations/reservations.repository.ts` — `holdSeats` → `holdSeat` (single), add
  `extendHold`, add `confirm`.
- `backend/src/reservations/reservations.service.ts` — single-seat `reserve()`, `findOwned`, `getById`,
  `extendHold`, `confirmPayment`, `finalizeCancel`, lockout check, `CONFIRMED`-cancel delegation.
- `backend/src/reservations/reservations.module.ts` — `forwardRef(() => PaymentsModule)`.
- `backend/src/reservations/events/reservation.events.ts` — add `RESERVATION_CONFIRMED`.
- `backend/src/reservations/test/*.spec.ts` — updated for single-seat shape.
- `backend/src/gateway/reservation-broadcast.listener.ts` — `RESERVATION_CONFIRMED` → `seat:booked`.
- `backend/src/gateway/test/reservation-broadcast.listener.spec.ts`
- `backend/src/cron/hold-expiry.cron.ts` — reconciliation job.
- `backend/src/cron/cron.module.ts` — import `PaymentsModule`.
- `backend/src/cron/test/hold-expiry.cron.spec.ts`
- `backend/src/redis/redis.module.ts` — register `PaymentAbuseService`.
- `backend/src/app.module.ts` — import `PaymentsModule`.

---

## Task 1: Expand `PaymentStatus` enum

**Files:**
- Modify: `backend/prisma/schema.prisma:32-37`

- [ ] **Step 1: Edit the enum**

```prisma
enum PaymentStatus {
  PENDING
  IN_PROGRESS
  SUCCEEDED
  DECLINED
  TIMED_OUT
  FAILED
  REFUNDED
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `cd backend && npx prisma migrate dev --name expand_payment_status`
Expected: a new folder under `backend/prisma/migrations/` containing an `ALTER TYPE`/enum-rebuild SQL
script, applied to your local dev DB with no errors (the `payment` table is empty pre-phase-9, so this is
a safe rename/add with no data migration).

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd backend && npx prisma generate`
Expected: no errors; `@prisma/client`'s `PaymentStatus` type now has the 7 values.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(payments): expand PaymentStatus enum to the full flow"
```

---

## Task 2: RefundPolicy seed data

**Files:**
- Create: `backend/prisma/seed.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the seed script**

```typescript
// backend/prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.refundPolicy.upsert({
    where: { hoursFrom_hoursTo: { hoursFrom: 48, hoursTo: 100_000 } },
    update: { refundPercent: 100 },
    create: { hoursFrom: 48, hoursTo: 100_000, refundPercent: 100 },
  });
  await prisma.refundPolicy.upsert({
    where: { hoursFrom_hoursTo: { hoursFrom: 24, hoursTo: 48 } },
    update: { refundPercent: 50 },
    create: { hoursFrom: 24, hoursTo: 48, refundPercent: 50 },
  });
  await prisma.refundPolicy.upsert({
    where: { hoursFrom_hoursTo: { hoursFrom: 0, hoursTo: 24 } },
    update: { refundPercent: 0 },
    create: { hoursFrom: 0, hoursTo: 24, refundPercent: 0 },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Wire it into `package.json` so `prisma db seed` / `db:reset` find it**

```json
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  },
```

Add this as a new top-level key in `backend/package.json` (alongside `"scripts"`, `"dependencies"`, etc.).

- [ ] **Step 3: Run it against your local dev DB**

Run: `cd backend && npx prisma db seed`
Expected: no errors; `SELECT * FROM refund_policy;` in psql/Prisma Studio shows exactly 3 rows
(0-24h→0%, 24-48h→50%, 48-100000h→100%).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts backend/package.json
git commit -m "feat(payments): seed the three default RefundPolicy rows"
```

---

## Task 3: Single-seat `CreateReservationDto`

**Files:**
- Modify: `backend/src/reservations/dto/create-reservation.dto.ts`

- [ ] **Step 1: Replace the array field with a single int**

```typescript
import { IsInt, Min } from 'class-validator';

export class CreateReservationDto {
  @IsInt()
  @Min(1)
  screeningId: number;

  @IsInt()
  @Min(1)
  seatId: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/reservations/dto/create-reservation.dto.ts
git commit -m "feat(reservations): reserve accepts a single seatId, not seatIds[]"
```

(No standalone DTO test file exists in this codebase — `class-validator` decorators are exercised via
the controller/e2e layer, covered in Task 5.)

---

## Task 4: Single-seat `ReservationsRepository`

**Files:**
- Modify: `backend/src/reservations/reservations.repository.ts`
- Test: `backend/src/reservations/test/reservations.repository.spec.ts`

- [ ] **Step 1: Rewrite the failing tests for `holdSeat` (singular) and add tests for `extendHold`/`confirm`**

Replace the entire `describe('holdSeats', ...)` block and the `holdParams` fixture, and add two new
`describe` blocks, in `backend/src/reservations/test/reservations.repository.spec.ts`:

```typescript
const HELD_UNTIL = new Date('2026-07-02T12:10:00.000Z');
const holdParams = {
  userId: 7,
  screeningId: 3,
  hallId: 2,
  seatId: 11,
  heldUntil: HELD_UNTIL,
};

describe('holdSeat', () => {
  it('locks the seat, inserts one HELD row, and returns it', async () => {
    mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
    mockTx.reservation.findFirst.mockResolvedValue(null);
    const created = { id: 100 };
    mockTx.reservation.create.mockResolvedValue(created);

    await expect(repo.holdSeat(holdParams)).resolves.toBe(created);

    expect(mockTx.reservation.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        screeningId: 3,
        seatId: 11,
        status: ReservationStatus.HELD,
        heldUntil: HELD_UNTIL,
      },
    });
  });

  it('throws 400 when the seat is not in the hall (lock returns no row)', async () => {
    mockTx.$queryRaw.mockResolvedValue([]);

    await expect(repo.holdSeat(holdParams)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockTx.reservation.create).not.toHaveBeenCalled();
  });

  it('throws 409 when the seat is already actively reserved', async () => {
    mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
    mockTx.reservation.findFirst.mockResolvedValue({ id: 55 });

    await expect(repo.holdSeat(holdParams)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockTx.reservation.create).not.toHaveBeenCalled();
  });

  it('maps a unique-index violation (P2002) to 409', async () => {
    mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
    mockTx.reservation.findFirst.mockResolvedValue(null);
    mockTx.reservation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(repo.holdSeat(holdParams)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('only checks HELD/CONFIRMED reservations for the requested seat', async () => {
    mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
    mockTx.reservation.findFirst.mockResolvedValue(null);
    mockTx.reservation.create.mockResolvedValue({ id: 100 });

    await repo.holdSeat(holdParams);

    expect(mockTx.reservation.findFirst).toHaveBeenCalledWith({
      where: {
        screeningId: 3,
        seatId: 11,
        status: {
          in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
        },
      },
      select: { id: true },
    });
  });
});

describe('extendHold', () => {
  it('updates heldUntil by id', async () => {
    mockPrisma.reservation.update.mockResolvedValue({ id: 5 });
    const until = new Date('2026-07-02T12:30:00.000Z');

    await repo.extendHold(5, until);

    expect(mockPrisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { heldUntil: until },
    });
  });
});

describe('confirm', () => {
  it('sets status CONFIRMED and clears heldUntil', async () => {
    mockPrisma.reservation.update.mockResolvedValue({ id: 5 });

    await repo.confirm(5);

    expect(mockPrisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: ReservationStatus.CONFIRMED, heldUntil: null },
    });
  });
});
```

Also update `mockTx` at the top of the file: replace `createManyAndReturn: jest.fn()` with `create:
jest.fn()` and add `findFirst: jest.fn()` alongside the existing `findMany: jest.fn()` (keep `findMany`,
`releaseExpiredHolds` still uses raw SQL and other describe blocks — like `findByUser` — still use
`reservation.findMany` on `mockPrisma`, not `mockTx`, so don't remove it from `mockPrisma.reservation`).

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest reservations.repository.spec.ts`
Expected: FAIL — `repo.holdSeat is not a function`, `repo.extendHold is not a function`, `repo.confirm is
not a function`.

- [ ] **Step 3: Implement `holdSeat`, `extendHold`, `confirm`**

Replace the `HoldSeatsParams` interface and `holdSeats` method in
`backend/src/reservations/reservations.repository.ts`:

```typescript
export interface HoldSeatParams {
  userId: number;
  screeningId: number;
  hallId: number;
  seatId: number;
  heldUntil: Date;
}
```

```typescript
  /**
   * Atomically hold one seat for a screening.
   *
   * Runs at the connection default isolation (READ COMMITTED), so once a racing
   * transaction commits, our post-lock existence check reads its fresh row and
   * bows out with a 409. Correctness rests on three layers:
   *   1. `FOR UPDATE` serializes concurrent reservers of the same seat.
   *   2. the existence check rejects a seat already HELD/CONFIRMED.
   *   3. the partial unique index (P2002) is the final backstop.
   */
  holdSeat(params: HoldSeatParams): Promise<Reservation> {
    const { userId, screeningId, hallId, seatId, heldUntil } = params;

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id FROM "seat"
        WHERE id = ${seatId} AND "hallId" = ${hallId}
        FOR UPDATE`);
      if (locked.length !== 1) {
        throw new BadRequestException(
          'Seat does not exist in this screening hall',
        );
      }

      const taken = await tx.reservation.findFirst({
        where: {
          screeningId,
          seatId,
          status: {
            in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
          },
        },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException(
          'This seat is already reserved for this screening',
        );
      }

      try {
        return await tx.reservation.create({
          data: { userId, screeningId, seatId, status: ReservationStatus.HELD, heldUntil },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            'This seat is already reserved for this screening',
          );
        }
        throw err;
      }
    });
  }

  /** Pushes heldUntil out — used when a checkout session outlives the normal hold window. */
  extendHold(id: number, until: Date): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: { heldUntil: until },
    });
  }

  /** HELD -> CONFIRMED on successful payment; heldUntil no longer applies. */
  confirm(id: number): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CONFIRMED, heldUntil: null },
    });
  }
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd backend && npx jest reservations.repository.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/reservations/reservations.repository.ts backend/src/reservations/test/reservations.repository.spec.ts
git commit -m "feat(reservations): single-seat holdSeat, add extendHold/confirm"
```

---

## Task 5: Single-seat `ReservationsService` (no payments wiring yet)

This task makes `reserve()` single-seat and adds the plumbing methods `PaymentsService` will call later
(`findOwned`, `getById`, `extendHold`, `confirmPayment`). It does **not** yet add the lockout check or the
`CONFIRMED`-cancel branch — those need `PaymentAbuseService`/`PaymentsService`, which don't exist until
Tasks 7 and 11.

**Files:**
- Modify: `backend/src/reservations/events/reservation.events.ts`
- Modify: `backend/src/reservations/reservations.service.ts`
- Test: `backend/src/reservations/test/reservations.service.spec.ts`
- Test: `backend/src/reservations/test/reservations.controller.spec.ts`

- [ ] **Step 1: Add the `RESERVATION_CONFIRMED` event constant**

```typescript
// backend/src/reservations/events/reservation.events.ts
export const RESERVATION_CREATED = 'reservation.created';
export const RESERVATION_CANCELLED = 'reservation.cancelled';
export const RESERVATION_CONFIRMED = 'reservation.confirmed';
```

- [ ] **Step 2: Rewrite the failing `reserve` tests for single-seat, add tests for the new methods**

Replace the `describe('reserve', ...)` block in
`backend/src/reservations/test/reservations.service.spec.ts` and add new blocks:

```typescript
  describe('reserve', () => {
    const dto = { screeningId: 3, seatId: 11 };

    it('holds the seat and returns the created reservation', async () => {
      const created = { id: 100, seatId: 11 };
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeat.mockResolvedValue(created);

      await expect(service.reserve(7, dto)).resolves.toBe(created);

      expect(mockReservationsRepo.holdSeat).toHaveBeenCalledWith({
        userId: 7,
        screeningId: 3,
        hallId: 2,
        seatId: 11,
        heldUntil: HELD_UNTIL,
      });
    });

    it('emits reservation.created with the screening id and seat id', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeat.mockResolvedValue({ id: 100, seatId: 11 });

      await service.reserve(7, dto);

      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CREATED, {
        screeningId: 3,
        seatIds: [11],
      });
    });

    it('throws 404 when the screening does not exist', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.holdSeat).not.toHaveBeenCalled();
    });

    it('throws 404 when the screening is not SCHEDULED', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        status: ScreenStatus.CANCELLED,
      });

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.holdSeat).not.toHaveBeenCalled();
    });

    it('throws 400 when the screening has already started', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        startTime: new Date('2026-07-02T11:59:59.000Z'),
      });

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockReservationsRepo.holdSeat).not.toHaveBeenCalled();
    });

    it('does not emit when the hold fails', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeat.mockRejectedValue(new ConflictException());

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });
  });

  describe('findOwned', () => {
    it('returns the reservation when owned by the caller', async () => {
      const reservation = { id: 100, userId: 7 };
      mockReservationsRepo.findById.mockResolvedValue(reservation);

      await expect(service.findOwned(7, 100)).resolves.toBe(reservation);
    });

    it('throws 404 when missing', async () => {
      mockReservationsRepo.findById.mockResolvedValue(null);

      await expect(service.findOwned(7, 100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when owned by someone else', async () => {
      mockReservationsRepo.findById.mockResolvedValue({ id: 100, userId: 99 });

      await expect(service.findOwned(7, 100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getById', () => {
    it('returns the reservation regardless of owner', async () => {
      const reservation = { id: 100, userId: 7 };
      mockReservationsRepo.findById.mockResolvedValue(reservation);

      await expect(service.getById(100)).resolves.toBe(reservation);
    });

    it('throws 404 when missing', async () => {
      mockReservationsRepo.findById.mockResolvedValue(null);

      await expect(service.getById(100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('extendHold', () => {
    it('delegates to the repository', async () => {
      const until = new Date('2026-07-02T12:30:00.000Z');
      const updated = { id: 100, heldUntil: until };
      mockReservationsRepo.extendHold.mockResolvedValue(updated);

      await expect(service.extendHold(100, until)).resolves.toBe(updated);
      expect(mockReservationsRepo.extendHold).toHaveBeenCalledWith(100, until);
    });
  });

  describe('confirmPayment', () => {
    it('confirms the reservation and emits reservation.confirmed', async () => {
      const confirmed = { id: 100, screeningId: 3, seatId: 11 };
      mockReservationsRepo.confirm.mockResolvedValue(confirmed);

      await expect(service.confirmPayment(100)).resolves.toBe(confirmed);

      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CONFIRMED, {
        screeningId: 3,
        seatIds: [11],
      });
    });
  });
```

Add `holdSeat: jest.fn(), extendHold: jest.fn(), confirm: jest.fn()` to `mockReservationsRepo` (replacing
`holdSeats: jest.fn()`), and import `RESERVATION_CONFIRMED` alongside the existing event imports.

- [ ] **Step 3: Update the `cancel` describe block's HELD test to use `finalizeCancel` internally (behavior
unchanged, still HELD-only for now) and controller spec's dto literal**

In `reservations.service.spec.ts`, the existing `cancel` tests need no behavioral change yet — leave them
as-is (still expects 409 for non-HELD). In
`backend/src/reservations/test/reservations.controller.spec.ts`, change line 41:

```typescript
      const dto = { screeningId: 3, seatId: 11 };
```

- [ ] **Step 4: Run the tests, confirm they fail**

Run: `cd backend && npx jest reservations.service.spec.ts reservations.controller.spec.ts`
Expected: FAIL — `service.findOwned is not a function`, `service.getById is not a function`, etc., plus
the rewritten `reserve` tests failing against the old `seatIds[]`-based implementation.

- [ ] **Step 5: Implement the single-seat service**

Replace the whole of `backend/src/reservations/reservations.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reservation, ReservationStatus, ScreenStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReservationsRepository } from './reservations.repository';
import { ScreeningsRepository } from '../screenings/screenings.repository';
import { CreateReservationDto } from './dto/create-reservation.dto';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CONFIRMED,
  RESERVATION_CREATED,
} from './events/reservation.events';

const HOLD_MINUTES = 10;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly reservationsRepo: ReservationsRepository,
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Hold one seat for a screening. Creates a HELD reservation; confirmation
   * happens later on payment.
   */
  async reserve(
    userId: number,
    dto: CreateReservationDto,
  ): Promise<Reservation> {
    const screening = await this.screeningsRepo.findById(dto.screeningId);
    if (!screening || screening.status !== ScreenStatus.SCHEDULED) {
      throw new NotFoundException(`Screening ${dto.screeningId} not found`);
    }
    if (screening.startTime <= new Date()) {
      throw new BadRequestException('Screening has already started');
    }

    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60_000);

    const reservation = await this.reservationsRepo.holdSeat({
      userId,
      screeningId: dto.screeningId,
      hallId: screening.hallId,
      seatId: dto.seatId,
      heldUntil,
    });

    this.events.emit(RESERVATION_CREATED, {
      screeningId: dto.screeningId,
      seatIds: [reservation.seatId],
    });
    return reservation;
  }

  /**
   * Release every HELD reservation whose 10-minute hold has expired. Groups
   * the released rows by screening and emits the existing
   * `reservation.cancelled` event per group.
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

  async cancel(userId: number, id: number): Promise<Reservation> {
    const reservation = await this.findOwned(userId, id);
    if (reservation.status !== ReservationStatus.HELD) {
      throw new ConflictException('Only a held reservation can be cancelled');
    }
    return this.finalizeCancel(reservation);
  }

  /** Sets CANCELLED and emits the shared cache/broadcast event. Also called by PaymentsService's refund flow. */
  async finalizeCancel(reservation: Reservation): Promise<Reservation> {
    const cancelled = await this.reservationsRepo.setStatus(
      reservation.id,
      ReservationStatus.CANCELLED,
    );
    this.events.emit(RESERVATION_CANCELLED, {
      screeningId: reservation.screeningId,
      seatIds: [reservation.seatId],
    });
    return cancelled;
  }

  /** 404 (not 403) when it belongs to someone else, to avoid leaking existence. */
  async findOwned(userId: number, id: number): Promise<Reservation> {
    const reservation = await this.reservationsRepo.findById(id);
    if (!reservation || reservation.userId !== userId) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  /** No ownership check — for trusted system callers (webhook, cron). */
  async getById(id: number): Promise<Reservation> {
    const reservation = await this.reservationsRepo.findById(id);
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  extendHold(id: number, until: Date): Promise<Reservation> {
    return this.reservationsRepo.extendHold(id, until);
  }

  async confirmPayment(id: number): Promise<Reservation> {
    const reservation = await this.reservationsRepo.confirm(id);
    this.events.emit(RESERVATION_CONFIRMED, {
      screeningId: reservation.screeningId,
      seatIds: [reservation.seatId],
    });
    return reservation;
  }

  listMine(userId: number): Promise<Reservation[]> {
    return this.reservationsRepo.findByUser(userId);
  }
}
```

Also update `backend/src/reservations/reservations.controller.ts`'s `reserve` method's return type
comment/usage stays the same (it just proxies `dto`; no code change needed there beyond what the DTO
already forces).

- [ ] **Step 6: Run the tests, confirm they pass**

Run: `cd backend && npx jest reservations.service.spec.ts reservations.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/reservations backend/src/reservations/events/reservation.events.ts
git commit -m "feat(reservations): single-seat reserve(), findOwned/getById/extendHold/confirmPayment"
```

---

## Task 6: `PaymentAbuseService` (in `RedisModule`)

**Files:**
- Create: `backend/src/redis/payment-abuse.service.ts`
- Create: `backend/src/redis/test/payment-abuse.service.spec.ts`
- Modify: `backend/src/redis/redis.module.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/redis/test/payment-abuse.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import PaymentAbuseService from '../payment-abuse.service';
import RedisCache from '../redis.cache';

const mockClient = {
  zadd: jest.fn(),
  zremrangebyscore: jest.fn(),
  zcard: jest.fn(),
  set: jest.fn(),
  exists: jest.fn(),
};
const mockRedisCache = { getClient: () => mockClient };

describe('PaymentAbuseService', () => {
  let service: PaymentAbuseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-07T12:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentAbuseService,
        { provide: RedisCache, useValue: mockRedisCache },
      ],
    }).compile();

    service = module.get<PaymentAbuseService>(PaymentAbuseService);
  });

  afterEach(() => jest.useRealTimers());

  describe('recordFailure', () => {
    it('adds a failure and does not lock out under 3', async () => {
      mockClient.zcard.mockResolvedValue(2);

      await service.recordFailure(7);

      expect(mockClient.zadd).toHaveBeenCalledWith(
        'payment_failures:user:7',
        expect.any(Number),
        expect.any(String),
      );
      expect(mockClient.set).not.toHaveBeenCalled();
    });

    it('sets a 30min lockout key on the 3rd failure within the window', async () => {
      mockClient.zcard.mockResolvedValue(3);

      await service.recordFailure(7);

      expect(mockClient.set).toHaveBeenCalledWith(
        'payment_lockout:user:7',
        '1',
        'PX',
        30 * 60_000,
      );
    });

    it('prunes failures older than 24h before counting', async () => {
      mockClient.zcard.mockResolvedValue(1);
      const now = Date.now();

      await service.recordFailure(7);

      expect(mockClient.zremrangebyscore).toHaveBeenCalledWith(
        'payment_failures:user:7',
        0,
        now - 24 * 60 * 60_000,
      );
    });
  });

  describe('isLockedOut', () => {
    it('returns true when the lockout key exists', async () => {
      mockClient.exists.mockResolvedValue(1);

      await expect(service.isLockedOut(7)).resolves.toBe(true);
      expect(mockClient.exists).toHaveBeenCalledWith('payment_lockout:user:7');
    });

    it('returns false when the lockout key is absent', async () => {
      mockClient.exists.mockResolvedValue(0);

      await expect(service.isLockedOut(7)).resolves.toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest payment-abuse.service.spec.ts`
Expected: FAIL — cannot find module `../payment-abuse.service`.

- [ ] **Step 3: Implement `PaymentAbuseService`**

```typescript
// backend/src/redis/payment-abuse.service.ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import RedisCache from './redis.cache';

const WINDOW_MS = 24 * 60 * 60_000;
const LOCKOUT_MS = 30 * 60_000;
const FAILURE_THRESHOLD = 3;

/**
 * Payment-abuse lockout: 3 failed/declined payments in a rolling 24h window
 * blocks new reservation creation for 30 min. Plain ioredis calls (not the
 * Lua-script pattern RateLimiterService uses) — this only *sets* a lockout
 * once a threshold is crossed and *reads* a single key to check it, no
 * admit/reject decision under contention.
 */
@Injectable()
export default class PaymentAbuseService {
  constructor(private readonly redis: RedisCache) {}

  async recordFailure(userId: number): Promise<void> {
    const key = `payment_failures:user:${userId}`;
    const now = Date.now();
    const client = this.redis.getClient();
    await client.zadd(key, now, `${now}-${randomUUID()}`);
    await client.zremrangebyscore(key, 0, now - WINDOW_MS);
    const count = await client.zcard(key);
    if (count >= FAILURE_THRESHOLD) {
      await client.set(`payment_lockout:user:${userId}`, '1', 'PX', LOCKOUT_MS);
    }
  }

  async isLockedOut(userId: number): Promise<boolean> {
    const client = this.redis.getClient();
    return (await client.exists(`payment_lockout:user:${userId}`)) === 1;
  }
}
```

- [ ] **Step 4: Register it in `RedisModule`**

```typescript
// backend/src/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import RedisCache from './redis.cache';
import RedisPubSub from './redis.pubsub';
import RateLimiterService from './rate-limiter.service';
import PaymentAbuseService from './payment-abuse.service';

@Global()
@Module({
  providers: [RedisCache, RedisPubSub, RateLimiterService, PaymentAbuseService],
  exports: [RedisCache, RedisPubSub, RateLimiterService, PaymentAbuseService],
})
export class RedisModule {}
```

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `cd backend && npx jest payment-abuse.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/redis
git commit -m "feat(payments): add PaymentAbuseService lockout in RedisModule"
```

---

## Task 7: Wire the lockout check into `ReservationsService.reserve()`

**Files:**
- Modify: `backend/src/reservations/reservations.service.ts`
- Modify: `backend/src/reservations/reservations.module.ts`
- Test: `backend/src/reservations/test/reservations.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `reservations.service.spec.ts`, inside `describe('reserve', ...)`:

```typescript
    it('throws 403 when the user is payment-locked-out, before any hold logic runs', async () => {
      mockPaymentAbuse.isLockedOut.mockResolvedValue(true);

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockScreeningsRepo.findById).not.toHaveBeenCalled();
      expect(mockReservationsRepo.holdSeat).not.toHaveBeenCalled();
    });

    it('proceeds when the user is not locked out', async () => {
      mockPaymentAbuse.isLockedOut.mockResolvedValue(false);
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeat.mockResolvedValue({ id: 100, seatId: 11 });

      await expect(service.reserve(7, dto)).resolves.toMatchObject({ id: 100 });
    });
```

Add near the top of the file, alongside the other mocks:

```typescript
const mockPaymentAbuse = { isLockedOut: jest.fn().mockResolvedValue(false), recordFailure: jest.fn() };
```

And add `{ provide: PaymentAbuseService, useValue: mockPaymentAbuse }` to the `providers` array in
`beforeEach`, plus `import PaymentAbuseService from '../../redis/payment-abuse.service';` and `import {
ForbiddenException } from '@nestjs/common';` (extend the existing `@nestjs/common` import).

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest reservations.service.spec.ts`
Expected: FAIL — `Nest can't resolve dependencies of ReservationsService` (missing `PaymentAbuseService`
provider) once it's added to the constructor, or the two new tests fail against the un-wired service.

- [ ] **Step 3: Add the lockout check**

In `backend/src/reservations/reservations.service.ts`:

```typescript
import PaymentAbuseService from '../redis/payment-abuse.service';
```

```typescript
  constructor(
    private readonly reservationsRepo: ReservationsRepository,
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly events: EventEmitter2,
    private readonly paymentAbuse: PaymentAbuseService,
  ) {}
```

```typescript
  async reserve(
    userId: number,
    dto: CreateReservationDto,
  ): Promise<Reservation> {
    if (await this.paymentAbuse.isLockedOut(userId)) {
      throw new ForbiddenException(
        'Too many failed payments — try again later',
      );
    }

    const screening = await this.screeningsRepo.findById(dto.screeningId);
    // ...rest unchanged
```

(Add `ForbiddenException` to the existing `@nestjs/common` import list.)

`ReservationsModule` needs no import change here — `PaymentAbuseService` comes from the `@Global()`
`RedisModule`, injectable anywhere without an explicit module import.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd backend && npx jest reservations.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/reservations/reservations.service.ts backend/src/reservations/test/reservations.service.spec.ts
git commit -m "feat(reservations): block reserve() for payment-locked-out users"
```

---

## Task 8: `PaymentsRepository`

**Files:**
- Create: `backend/src/payments/payments.repository.ts`
- Create: `backend/src/payments/test/payments.repository.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/payments/test/payments.repository.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsRepository } from '../payments.repository';

const mockPrisma = {
  payment: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  refundPolicy: {
    findFirst: jest.fn(),
  },
};

describe('PaymentsRepository', () => {
  let repo: PaymentsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    repo = module.get<PaymentsRepository>(PaymentsRepository);
  });

  describe('findByReservationId', () => {
    it('looks up by the unique reservationId', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({ id: 1 });

      await repo.findByReservationId(100);

      expect(mockPrisma.payment.findUnique).toHaveBeenCalledWith({
        where: { reservationId: 100 },
      });
    });
  });

  describe('findByStripeEventId', () => {
    it('looks up by the unique stripeEventId', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      await repo.findByStripeEventId('evt_123');

      expect(mockPrisma.payment.findUnique).toHaveBeenCalledWith({
        where: { stripeEventId: 'evt_123' },
      });
    });
  });

  describe('findByStripePaymentId', () => {
    it('looks up by stripePaymentId', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([{ id: 1 }]);

      await repo.findByStripePaymentId('pi_123');

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith({
        where: { stripePaymentId: 'pi_123' },
        take: 1,
      });
    });
  });

  describe('create', () => {
    it('creates a Payment row', async () => {
      const data = {
        reservationId: 100,
        amount: 5000,
        currency: 'egp',
        status: PaymentStatus.PENDING,
        stripeSessionId: '',
      };
      mockPrisma.payment.create.mockResolvedValue({ id: 1, ...data });

      await repo.create(data);

      expect(mockPrisma.payment.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('update', () => {
    it('updates a Payment row by id', async () => {
      mockPrisma.payment.update.mockResolvedValue({ id: 1 });

      await repo.update(1, { status: PaymentStatus.SUCCEEDED });

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: PaymentStatus.SUCCEEDED },
      });
    });
  });

  describe('findStuckTimedOut', () => {
    it('finds TIMED_OUT payments older than the cutoff', async () => {
      const cutoff = new Date('2026-07-07T00:00:00.000Z');
      mockPrisma.payment.findMany.mockResolvedValue([]);

      await repo.findStuckTimedOut(cutoff);

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith({
        where: { status: PaymentStatus.TIMED_OUT, createdAt: { lt: cutoff } },
      });
    });
  });

  describe('findRefundPolicy', () => {
    it('finds the policy whose [hoursFrom, hoursTo) range contains the value', async () => {
      mockPrisma.refundPolicy.findFirst.mockResolvedValue({ refundPercent: 50 });

      await repo.findRefundPolicy(30);

      expect(mockPrisma.refundPolicy.findFirst).toHaveBeenCalledWith({
        where: { hoursFrom: { lte: 30 }, hoursTo: { gt: 30 } },
      });
    });
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest payments.repository.spec.ts`
Expected: FAIL — cannot find module `../payments.repository`.

- [ ] **Step 3: Implement `PaymentsRepository`**

```typescript
// backend/src/payments/payments.repository.ts
import { Injectable } from '@nestjs/common';
import { Payment, Prisma, PaymentStatus, RefundPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByReservationId(reservationId: number): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { reservationId } });
  }

  findByStripeEventId(stripeEventId: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { stripeEventId } });
  }

  async findByStripePaymentId(stripePaymentId: string): Promise<Payment | null> {
    const [payment] = await this.prisma.payment.findMany({
      where: { stripePaymentId },
      take: 1,
    });
    return payment ?? null;
  }

  create(data: Prisma.PaymentUncheckedCreateInput): Promise<Payment> {
    return this.prisma.payment.create({ data });
  }

  update(id: number, data: Prisma.PaymentUncheckedUpdateInput): Promise<Payment> {
    return this.prisma.payment.update({ where: { id }, data });
  }

  findStuckTimedOut(olderThan: Date): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { status: PaymentStatus.TIMED_OUT, createdAt: { lt: olderThan } },
    });
  }

  findRefundPolicy(hoursUntilScreening: number): Promise<RefundPolicy | null> {
    return this.prisma.refundPolicy.findFirst({
      where: { hoursFrom: { lte: hoursUntilScreening }, hoursTo: { gt: hoursUntilScreening } },
    });
  }
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd backend && npx jest payments.repository.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/payments/payments.repository.ts backend/src/payments/test/payments.repository.spec.ts
git commit -m "feat(payments): add PaymentsRepository"
```

---

## Task 9: `PaymentsService` — checkout session creation

**Files:**
- Create: `backend/src/payments/payments.service.ts`
- Create: `backend/src/payments/test/payments.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/payments/test/payments.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PaymentStatus, ReservationStatus } from '@prisma/client';
import { PaymentsService } from '../payments.service';
import { PaymentsRepository } from '../payments.repository';
import { ReservationsService } from '../../reservations/reservations.service';
import { ScreeningsRepository } from '../../screenings/screenings.repository';
import PaymentAbuseService from '../../redis/payment-abuse.service';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn(),
        retrieve: jest.fn(),
      },
    },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }));
});

const mockPaymentsRepo = {
  findByReservationId: jest.fn(),
  findByStripeEventId: jest.fn(),
  findByStripePaymentId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  findStuckTimedOut: jest.fn(),
  findRefundPolicy: jest.fn(),
};
const mockReservationsService = {
  findOwned: jest.fn(),
  getById: jest.fn(),
  extendHold: jest.fn(),
  confirmPayment: jest.fn(),
  finalizeCancel: jest.fn(),
};
const mockScreeningsRepo = { findById: jest.fn() };
const mockPaymentAbuse = { recordFailure: jest.fn() };

const screening = { id: 3, price: 50, startTime: new Date('2026-07-10T18:00:00.000Z') };
const heldReservation = { id: 100, screeningId: 3, seatId: 11, status: ReservationStatus.HELD, userId: 7 };

describe('PaymentsService', () => {
  let service: PaymentsService;
  let stripeMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'http://localhost:5173';
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsRepository, useValue: mockPaymentsRepo },
        { provide: ReservationsService, useValue: mockReservationsService },
        { provide: ScreeningsRepository, useValue: mockScreeningsRepo },
        { provide: PaymentAbuseService, useValue: mockPaymentAbuse },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    stripeMock = (service as any).stripe;
  });

  describe('createCheckoutSession', () => {
    it('creates a Payment row, a Stripe session, and extends the hold', async () => {
      mockReservationsService.findOwned.mockResolvedValue(heldReservation);
      mockPaymentsRepo.findByReservationId.mockResolvedValue(null);
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockPaymentsRepo.create.mockResolvedValue({ id: 1, reservationId: 100 });
      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: 'cs_123',
        url: 'https://checkout.stripe.com/cs_123',
      });

      const result = await service.createCheckoutSession(7, 100);

      expect(result).toEqual({ url: 'https://checkout.stripe.com/cs_123' });
      expect(mockPaymentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId: 100,
          amount: 5000,
          currency: 'egp',
          status: PaymentStatus.PENDING,
        }),
      );
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          success_url: expect.stringContaining('/reservations/success'),
          cancel_url: 'http://localhost:5173/reservations',
          metadata: { paymentId: '1' },
        }),
      );
      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, { stripeSessionId: 'cs_123' });
      expect(mockReservationsService.extendHold).toHaveBeenCalledWith(100, expect.any(Date));
    });

    it('throws 409 when the reservation is not HELD', async () => {
      mockReservationsService.findOwned.mockResolvedValue({
        ...heldReservation,
        status: ReservationStatus.CONFIRMED,
      });

      await expect(service.createCheckoutSession(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPaymentsRepo.create).not.toHaveBeenCalled();
    });

    it('throws 409 when a Payment already exists for the reservation', async () => {
      mockReservationsService.findOwned.mockResolvedValue(heldReservation);
      mockPaymentsRepo.findByReservationId.mockResolvedValue({ id: 1 });

      await expect(service.createCheckoutSession(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPaymentsRepo.create).not.toHaveBeenCalled();
    });

    it('propagates the 404 from findOwned for a non-owned/missing reservation', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockReservationsService.findOwned.mockRejectedValue(new NotFoundException());

      await expect(service.createCheckoutSession(7, 999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: FAIL — cannot find module `../payments.service`.

- [ ] **Step 3: Implement `PaymentsService` (checkout session creation only for now)**

```typescript
// backend/src/payments/payments.service.ts
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import Stripe from 'stripe';
import { Payment, PaymentStatus, Reservation, ReservationStatus } from '@prisma/client';
import { PaymentsRepository } from './payments.repository';
import { ReservationsService } from '../reservations/reservations.service';
import { ScreeningsRepository } from '../screenings/screenings.repository';
import PaymentAbuseService from '../redis/payment-abuse.service';

const CHECKOUT_EXPIRY_MINUTES = 30;
const CURRENCY = 'egp';

@Injectable()
export class PaymentsService {
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

  constructor(
    private readonly paymentsRepo: PaymentsRepository,
    @Inject(forwardRef(() => ReservationsService))
    private readonly reservationsService: ReservationsService,
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly paymentAbuse: PaymentAbuseService,
  ) {}

  async createCheckoutSession(
    userId: number,
    reservationId: number,
  ): Promise<{ url: string }> {
    const reservation = await this.reservationsService.findOwned(userId, reservationId);
    if (reservation.status !== ReservationStatus.HELD) {
      throw new ConflictException('Reservation is not held');
    }
    const existing = await this.paymentsRepo.findByReservationId(reservationId);
    if (existing) {
      throw new ConflictException('This reservation already has a payment');
    }

    const screening = await this.screeningsRepo.findById(reservation.screeningId);
    const amount = screening!.price * 100;

    const payment = await this.paymentsRepo.create({
      reservationId,
      amount,
      currency: CURRENCY,
      status: PaymentStatus.PENDING,
      stripeSessionId: '',
    });

    const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRY_MINUTES * 60;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: { name: `Seat reservation #${reservationId}` },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/reservations/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/reservations`,
      expires_at: expiresAt,
      metadata: { paymentId: String(payment.id) },
    });

    await this.paymentsRepo.update(payment.id, { stripeSessionId: session.id });
    await this.reservationsService.extendHold(reservationId, new Date(expiresAt * 1000));

    return { url: session.url as string };
  }
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/payments/payments.service.ts backend/src/payments/test/payments.service.spec.ts
git commit -m "feat(payments): PaymentsService.createCheckoutSession"
```

---

## Task 10: `PaymentsService` — webhook handling

**Files:**
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/payments/test/payments.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `payments.service.spec.ts`:

```typescript
  describe('handleWebhookEvent', () => {
    const rawBody = Buffer.from('{}');
    const signature = 'sig_test';

    it('throws 400 on signature verification failure, writes nothing', async () => {
      const { BadRequestException } = require('@nestjs/common');
      stripeMock.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('bad signature');
      });

      await expect(
        service.handleWebhookEvent(rawBody, signature),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPaymentsRepo.update).not.toHaveBeenCalled();
    });

    it('no-ops on a duplicate stripeEventId', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({ id: 'evt_1', type: 'checkout.session.completed' });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue({ id: 1 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).not.toHaveBeenCalled();
    });

    it('checkout.session.completed (paid) -> SUCCEEDED, confirms the reservation', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: {
          object: {
            payment_status: 'paid',
            payment_intent: 'pi_1',
            metadata: { paymentId: '1' },
          },
        },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
      mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.SUCCEEDED,
        stripeEventId: 'evt_2',
        stripePaymentId: 'pi_1',
      });
      expect(mockReservationsService.confirmPayment).toHaveBeenCalledWith(100);
    });

    it('checkout.session.completed (unpaid, async) -> IN_PROGRESS, reservation untouched', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_3',
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'unpaid', metadata: { paymentId: '1' } } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.IN_PROGRESS,
        stripeEventId: 'evt_3',
      });
      expect(mockReservationsService.confirmPayment).not.toHaveBeenCalled();
    });

    it('checkout.session.async_payment_failed -> FAILED, records an abuse failure', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_4',
        type: 'checkout.session.async_payment_failed',
        data: { object: { metadata: { paymentId: '1' } } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
      mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });
      mockReservationsService.getById.mockResolvedValue({ id: 100, userId: 7 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.FAILED,
        stripeEventId: 'evt_4',
      });
      expect(mockPaymentAbuse.recordFailure).toHaveBeenCalledWith(7);
    });

    it('checkout.session.expired -> TIMED_OUT', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_5',
        type: 'checkout.session.expired',
        data: { object: { metadata: { paymentId: '1' } } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.TIMED_OUT,
        stripeEventId: 'evt_5',
      });
    });

    it('charge.dispute.created -> sets disputed fields, status unchanged', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_6',
        type: 'charge.dispute.created',
        data: { object: { payment_intent: 'pi_1', reason: 'fraudulent' } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
      mockPaymentsRepo.findByStripePaymentId.mockResolvedValue({ id: 1 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        disputed: true,
        disputeReason: 'fraudulent',
        disputedAt: expect.any(Date),
        stripeEventId: 'evt_6',
      });
    });
  });
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: FAIL — `service.handleWebhookEvent is not a function`.

- [ ] **Step 3: Implement webhook handling**

Add to `backend/src/payments/payments.service.ts` (new imports: `BadRequestException`; the class body
gains these methods):

```typescript
  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<{ received: true }> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET as string,
      );
    } catch (err) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
    }

    const alreadyProcessed = await this.paymentsRepo.findByStripeEventId(event.id);
    if (alreadyProcessed) {
      return { received: true };
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event);
        break;
      case 'checkout.session.async_payment_failed':
        await this.handleAsyncPaymentFailed(event);
        break;
      case 'checkout.session.expired':
        await this.handleCheckoutExpired(event);
        break;
      case 'charge.dispute.created':
        await this.handleDisputeCreated(event);
        break;
      default:
        break;
    }

    return { received: true };
  }

  private paymentIdFrom(session: Stripe.Checkout.Session): number {
    return Number(session.metadata?.paymentId);
  }

  private async handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = this.paymentIdFrom(session);

    if (session.payment_status === 'paid') {
      const payment = await this.paymentsRepo.update(paymentId, {
        status: PaymentStatus.SUCCEEDED,
        stripeEventId: event.id,
        stripePaymentId: session.payment_intent as string,
      });
      await this.reservationsService.confirmPayment(payment.reservationId);
      return;
    }

    await this.paymentsRepo.update(paymentId, {
      status: PaymentStatus.IN_PROGRESS,
      stripeEventId: event.id,
    });
  }

  private async handleAsyncPaymentFailed(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = this.paymentIdFrom(session);
    const payment = await this.paymentsRepo.update(paymentId, {
      status: PaymentStatus.FAILED,
      stripeEventId: event.id,
    });
    const reservation = await this.reservationsService.getById(payment.reservationId);
    await this.paymentAbuse.recordFailure(reservation.userId);
  }

  private async handleCheckoutExpired(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = this.paymentIdFrom(session);
    await this.paymentsRepo.update(paymentId, {
      status: PaymentStatus.TIMED_OUT,
      stripeEventId: event.id,
    });
  }

  private async handleDisputeCreated(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const payment = await this.paymentsRepo.findByStripePaymentId(dispute.payment_intent as string);
    if (!payment) return;
    await this.paymentsRepo.update(payment.id, {
      disputed: true,
      disputeReason: dispute.reason,
      disputedAt: new Date(),
      stripeEventId: event.id,
    });
  }
```

Add `BadRequestException` to the `@nestjs/common` import at the top of the file.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/payments/payments.service.ts backend/src/payments/test/payments.service.spec.ts
git commit -m "feat(payments): PaymentsService.handleWebhookEvent"
```

---

## Task 11: `PaymentsService` — refund on cancellation + wire `ReservationsService.cancel()`

This is the task that introduces the `forwardRef()` circular dependency: `PaymentsService.refundReservation`
calls back into `ReservationsService.finalizeCancel`, and `ReservationsService.cancel()` calls into
`PaymentsService.refundReservation` for a `CONFIRMED` row.

**Files:**
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/reservations/reservations.service.ts`
- Modify: `backend/src/payments/test/payments.service.spec.ts`
- Modify: `backend/src/reservations/test/reservations.service.spec.ts`

- [ ] **Step 1: Write the failing `refundReservation` tests**

Add to `payments.service.spec.ts`:

```typescript
  describe('refundReservation', () => {
    const confirmed = { id: 100, screeningId: 3, seatId: 11, status: ReservationStatus.CONFIRMED, userId: 7 };
    const payment = { id: 1, reservationId: 100, amount: 5000, stripePaymentId: 'pi_1' };

    it('full refund (>=48h out): refunds via Stripe, sets REFUNDED, cancels the reservation', async () => {
      mockPaymentsRepo.findByReservationId.mockResolvedValue(payment);
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        startTime: new Date(Date.now() + 72 * 60 * 60_000),
      });
      mockPaymentsRepo.findRefundPolicy.mockResolvedValue({ refundPercent: 100 });
      stripeMock.refunds.create.mockResolvedValue({ id: 're_1' });
      mockReservationsService.finalizeCancel.mockResolvedValue({ ...confirmed, status: 'CANCELLED' });

      await service.refundReservation(confirmed as any);

      expect(stripeMock.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_1',
        amount: 5000,
      });
      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.REFUNDED,
        refundId: 're_1',
        refundedAt: expect.any(Date),
      });
      expect(mockReservationsService.finalizeCancel).toHaveBeenCalledWith(confirmed);
    });

    it('no refund window (0%): skips the Stripe call, still cancels', async () => {
      mockPaymentsRepo.findByReservationId.mockResolvedValue(payment);
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        startTime: new Date(Date.now() + 1 * 60 * 60_000),
      });
      mockPaymentsRepo.findRefundPolicy.mockResolvedValue({ refundPercent: 0 });
      mockReservationsService.finalizeCancel.mockResolvedValue({ ...confirmed, status: 'CANCELLED' });

      await service.refundReservation(confirmed as any);

      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.REFUNDED,
        refundId: undefined,
        refundedAt: expect.any(Date),
      });
    });

    it('throws 404 when no Payment exists for the reservation', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockPaymentsRepo.findByReservationId.mockResolvedValue(null);

      await expect(service.refundReservation(confirmed as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: FAIL — `service.refundReservation is not a function`.

- [ ] **Step 3: Implement `refundReservation`**

Add to `backend/src/payments/payments.service.ts`:

```typescript
  async refundReservation(reservation: Reservation): Promise<Reservation> {
    const payment = await this.paymentsRepo.findByReservationId(reservation.id);
    if (!payment) {
      throw new NotFoundException(`No payment found for reservation ${reservation.id}`);
    }

    const screening = await this.screeningsRepo.findById(reservation.screeningId);
    const hoursUntilScreening =
      (screening!.startTime.getTime() - Date.now()) / (60 * 60 * 1000);
    const policy = await this.paymentsRepo.findRefundPolicy(hoursUntilScreening);
    const refundPercent = policy?.refundPercent ?? 0;
    const refundAmount = Math.round((payment.amount * refundPercent) / 100);

    let refundId: string | undefined;
    if (refundPercent > 0 && payment.stripePaymentId) {
      const refund = await this.stripe.refunds.create({
        payment_intent: payment.stripePaymentId,
        amount: refundAmount,
      });
      refundId = refund.id;
    }

    await this.paymentsRepo.update(payment.id, {
      status: PaymentStatus.REFUNDED,
      refundId,
      refundedAt: new Date(),
    });

    return this.reservationsService.finalizeCancel(reservation);
  }
```

- [ ] **Step 4: Write the failing `ReservationsService.cancel()` test for the CONFIRMED branch**

Update `describe('cancel', ...)` in `reservations.service.spec.ts` — the existing "throws 409 when the
reservation is not HELD" test used `ReservationStatus.CONFIRMED` as its non-HELD example; replace it and
add a new test:

```typescript
    it('delegates to PaymentsService.refundReservation for a CONFIRMED reservation', async () => {
      const confirmedReservation = { ...held, status: ReservationStatus.CONFIRMED };
      mockReservationsRepo.findById.mockResolvedValue(confirmedReservation);
      const refunded = { ...confirmedReservation, status: ReservationStatus.CANCELLED };
      mockPaymentsService.refundReservation.mockResolvedValue(refunded);

      await expect(service.cancel(7, 100)).resolves.toBe(refunded);

      expect(mockPaymentsService.refundReservation).toHaveBeenCalledWith(confirmedReservation);
      expect(mockReservationsRepo.setStatus).not.toHaveBeenCalled();
    });

    it('throws 409 when the reservation is CANCELLED (neither HELD nor CONFIRMED)', async () => {
      mockReservationsRepo.findById.mockResolvedValue({
        ...held,
        status: ReservationStatus.CANCELLED,
      });

      await expect(service.cancel(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockReservationsRepo.setStatus).not.toHaveBeenCalled();
    });
```

Add near the top of the file: `const mockPaymentsService = { refundReservation: jest.fn() };`, add
`{ provide: PaymentsService, useValue: mockPaymentsService }` to the `providers` array in `beforeEach`,
and `import { PaymentsService } from '../../payments/payments.service';`.

- [ ] **Step 5: Run the tests, confirm they fail**

Run: `cd backend && npx jest reservations.service.spec.ts payments.service.spec.ts`
Expected: FAIL — `refundReservation` tests fail against the pre-Step-3 service; `cancel()`'s CONFIRMED
test fails because `cancel()` still throws 409 for non-HELD.

- [ ] **Step 6: Wire `PaymentsService` into `ReservationsService.cancel()`**

In `backend/src/reservations/reservations.service.ts`:

```typescript
import { Inject, forwardRef } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
```

```typescript
  constructor(
    private readonly reservationsRepo: ReservationsRepository,
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly events: EventEmitter2,
    private readonly paymentAbuse: PaymentAbuseService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}
```

```typescript
  async cancel(userId: number, id: number): Promise<Reservation> {
    const reservation = await this.findOwned(userId, id);

    if (reservation.status === ReservationStatus.CONFIRMED) {
      return this.paymentsService.refundReservation(reservation);
    }
    if (reservation.status !== ReservationStatus.HELD) {
      throw new ConflictException('Only a held or confirmed reservation can be cancelled');
    }
    return this.finalizeCancel(reservation);
  }
```

- [ ] **Step 7: Run the tests, confirm they pass**

Run: `cd backend && npx jest reservations.service.spec.ts payments.service.spec.ts`
Expected: PASS, all tests green. (Module-level `forwardRef()` wiring in `reservations.module.ts` /
`payments.module.ts` happens in Task 12 — these unit tests use `useValue` mocks, so they pass before that
wiring exists.)

- [ ] **Step 8: Commit**

```bash
git add backend/src/payments/payments.service.ts backend/src/reservations/reservations.service.ts backend/src/payments/test/payments.service.spec.ts backend/src/reservations/test/reservations.service.spec.ts
git commit -m "feat(payments): refund-on-cancel, wire into ReservationsService.cancel()"
```

---

## Task 12: `PaymentsController`, module wiring, `app.module.ts`

**Files:**
- Create: `backend/src/payments/dto/create-checkout-session.dto.ts`
- Create: `backend/src/payments/payments.controller.ts`
- Create: `backend/src/payments/test/payments.controller.spec.ts`
- Create: `backend/src/payments/payments.module.ts`
- Modify: `backend/src/reservations/reservations.module.ts`
- Modify: `backend/src/app.module.ts`

This task is mostly wiring (no new business logic to TDD) — write the files, then verify with a full
build + test run rather than a narrow unit test, plus one controller spec for the delegation/guard
wiring (matching the existing `ReservationsController` spec's style).

- [ ] **Step 1: Add `getStatus` to `PaymentsService`**

Add to `backend/src/payments/payments.service.ts`:

```typescript
  async getStatus(
    userId: number,
    reservationId: number,
  ): Promise<{ reservationStatus: ReservationStatus; paymentStatus: PaymentStatus | null }> {
    const reservation = await this.reservationsService.findOwned(userId, reservationId);
    const payment = await this.paymentsRepo.findByReservationId(reservationId);
    return {
      reservationStatus: reservation.status,
      paymentStatus: payment?.status ?? null,
    };
  }
```

- [ ] **Step 2: DTO**

```typescript
// backend/src/payments/dto/create-checkout-session.dto.ts
import { IsInt, Min } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsInt()
  @Min(1)
  reservationId: number;
}
```

- [ ] **Step 3: Controller**

```typescript
// backend/src/payments/payments.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/token.service';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { PaymentsService } from './payments.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ points: 5, duration: 60_000, key: 'payments:checkout' })
  @Post('checkout-session')
  createCheckoutSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.paymentsService.createCheckoutSession(user.id, dto.reservationId);
  }

  @Post('webhook')
  handleWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.paymentsService.handleWebhookEvent(
      req.rawBody as Buffer,
      req.headers['stripe-signature'] as string,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('reservations/:reservationId/status')
  getStatus(
    @CurrentUser() user: AuthUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.paymentsService.getStatus(user.id, reservationId);
  }
}
```

- [ ] **Step 4: Controller spec (mirrors `reservations.controller.spec.ts`'s style)**

```typescript
// backend/src/payments/test/payments.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from '../payments.controller';
import { PaymentsService } from '../payments.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RATE_LIMIT_KEY } from '../../common/decorators/rate-limit.decorator';

const mockService = {
  createCheckoutSession: jest.fn(),
  handleWebhookEvent: jest.fn(),
  getStatus: jest.fn(),
};
const user = { id: 7, email: 'a@b.c', role: 'USER', name: 'A' };
const GUARDS_METADATA = '__guards__';

describe('PaymentsController', () => {
  let controller: PaymentsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: mockService }],
    }).compile();
    controller = module.get<PaymentsController>(PaymentsController);
  });

  describe('delegation', () => {
    it('createCheckoutSession -> service with caller id and reservationId', async () => {
      mockService.createCheckoutSession.mockResolvedValue({ url: 'https://x' });

      await controller.createCheckoutSession(user as never, { reservationId: 100 });

      expect(mockService.createCheckoutSession).toHaveBeenCalledWith(7, 100);
    });

    it('handleWebhook -> service with raw body and signature header', async () => {
      const req = {
        rawBody: Buffer.from('{}'),
        headers: { 'stripe-signature': 'sig_1' },
      } as never;
      mockService.handleWebhookEvent.mockResolvedValue({ received: true });

      await controller.handleWebhook(req);

      expect(mockService.handleWebhookEvent).toHaveBeenCalledWith(
        Buffer.from('{}'),
        'sig_1',
      );
    });

    it('getStatus -> service with caller id and reservationId', async () => {
      mockService.getStatus.mockResolvedValue({ reservationStatus: 'HELD', paymentStatus: null });

      await controller.getStatus(user as never, 100);

      expect(mockService.getStatus).toHaveBeenCalledWith(7, 100);
    });
  });

  describe('rate limit wiring (checkout-session)', () => {
    it('applies RateLimitGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        PaymentsController.prototype.createCheckoutSession,
      );
      expect(guards).toEqual([JwtAuthGuard, RateLimitGuard]);
    });

    it('sets rate-limit metadata: 5/1min, payments:checkout', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        PaymentsController.prototype.createCheckoutSession,
      );
      expect(meta).toEqual({ points: 5, duration: 60_000, key: 'payments:checkout' });
    });
  });
});
```

- [ ] **Step 5: `PaymentsModule`**

```typescript
// backend/src/payments/payments.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';

@Module({
  imports: [ScreeningsModule, forwardRef(() => ReservationsModule)],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService],
})
export class PaymentsModule {}
```

- [ ] **Step 6: `forwardRef` the other side, in `ReservationsModule`**

```typescript
// backend/src/reservations/reservations.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './reservations.repository';
import { ReservationCacheListener } from './listeners/reservation-cache.listener';

@Module({
  imports: [ScreeningsModule, forwardRef(() => PaymentsModule)],
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

- [ ] **Step 7: Import `PaymentsModule` in `app.module.ts`**

```typescript
import { PaymentsModule } from './payments/payments.module';
```

Add `PaymentsModule` to the `imports` array (anywhere after `ReservationsModule` is fine).

- [ ] **Step 8: Run the full test suite and build**

Run: `cd backend && npx jest`
Expected: PASS, all suites green (this is the first point every existing + new spec runs together —
it's where a missed forwardRef or DI wiring mistake would surface as a `Nest can't resolve dependencies`
error).

Run: `cd backend && npx nest build`
Expected: no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/payments backend/src/reservations/reservations.module.ts backend/src/app.module.ts
git commit -m "feat(payments): wire PaymentsModule (controller, forwardRef, app.module)"
```

---

## Task 13: `ReservationBroadcastListener` — `RESERVATION_CONFIRMED` → `seat:booked`

**Files:**
- Modify: `backend/src/gateway/reservation-broadcast.listener.ts`
- Modify: `backend/src/gateway/test/reservation-broadcast.listener.spec.ts`

- [ ] **Step 1: Read the existing spec's `handleCreated`/`handleCancelled` test shape**

(Already read in planning — the new test mirrors those two exactly, swapping the event/status.)

- [ ] **Step 2: Write the failing test**

Add to `backend/src/gateway/test/reservation-broadcast.listener.spec.ts`, alongside the existing
`handleCreated`/`handleCancelled` describe blocks (same fixtures/mocks pattern as those):

```typescript
  describe('handleConfirmed', () => {
    it('broadcasts seat:booked with SeatStatus.BOOKED', async () => {
      mockScreeningsService.getScreeningSummary.mockResolvedValue(summary);

      await listener.handleConfirmed({ screeningId: 3, seatIds: [11] });

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(3, 'seat:booked', {
        screeningId: 3,
        seatIds: [11],
        status: SeatStatus.BOOKED,
      });
    });
  });
```

(Match whatever the file's existing `summary`/`mockScreeningsService`/`mockGateway` fixture names are —
reuse them, don't redeclare.)

- [ ] **Step 3: Run the test, confirm it fails**

Run: `cd backend && npx jest reservation-broadcast.listener.spec.ts`
Expected: FAIL — `listener.handleConfirmed is not a function`.

- [ ] **Step 4: Implement the new handler**

In `backend/src/gateway/reservation-broadcast.listener.ts`:

```typescript
import {
  RESERVATION_CANCELLED,
  RESERVATION_CONFIRMED,
  RESERVATION_CREATED,
  type ReservationChangedPayload,
} from '../reservations/events/reservation.events';
```

```typescript
  @OnEvent(RESERVATION_CONFIRMED)
  async handleConfirmed(payload: ReservationChangedPayload): Promise<void> {
    await this.broadcast(payload, 'seat:booked', SeatStatus.BOOKED);
  }
```

Remove the now-resolved `DEFERRED(phase-9)` comment block above `private async broadcast(...)`.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `cd backend && npx jest reservation-broadcast.listener.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/gateway/reservation-broadcast.listener.ts backend/src/gateway/test/reservation-broadcast.listener.spec.ts
git commit -m "feat(payments): broadcast seat:booked on reservation.confirmed"
```

---

## Task 14: Reconciliation cron

**Files:**
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/payments/test/payments.service.spec.ts`
- Modify: `backend/src/cron/hold-expiry.cron.ts`
- Modify: `backend/src/cron/cron.module.ts`
- Modify: `backend/src/cron/test/hold-expiry.cron.spec.ts`

- [ ] **Step 1: Write the failing `reconcileTimedOutPayments` tests**

Add to `payments.service.spec.ts`:

```typescript
  describe('reconcileTimedOutPayments', () => {
    it('confirms a payment Stripe reports as paid', async () => {
      mockPaymentsRepo.findStuckTimedOut.mockResolvedValue([
        { id: 1, reservationId: 100, stripeSessionId: 'cs_1' },
      ]);
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        payment_status: 'paid',
        payment_intent: 'pi_9',
      });
      mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });

      await service.reconcileTimedOutPayments();

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.SUCCEEDED,
        stripePaymentId: 'pi_9',
      });
      expect(mockReservationsService.confirmPayment).toHaveBeenCalledWith(100);
    });

    it('declines a payment Stripe does not report as paid, records abuse failure', async () => {
      mockPaymentsRepo.findStuckTimedOut.mockResolvedValue([
        { id: 2, reservationId: 101, stripeSessionId: 'cs_2' },
      ]);
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({ payment_status: 'unpaid' });
      mockPaymentsRepo.update.mockResolvedValue({ id: 2, reservationId: 101 });
      mockReservationsService.getById.mockResolvedValue({ id: 101, userId: 7 });

      await service.reconcileTimedOutPayments();

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(2, { status: PaymentStatus.DECLINED });
      expect(mockPaymentAbuse.recordFailure).toHaveBeenCalledWith(7);
    });

    it('does nothing when there are no stuck payments', async () => {
      mockPaymentsRepo.findStuckTimedOut.mockResolvedValue([]);

      await service.reconcileTimedOutPayments();

      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: FAIL — `service.reconcileTimedOutPayments is not a function`.

- [ ] **Step 3: Implement it**

Add to `backend/src/payments/payments.service.ts`:

```typescript
const RECONCILE_GRACE_MINUTES = 10;
```

```typescript
  async reconcileTimedOutPayments(): Promise<void> {
    const cutoff = new Date(Date.now() - RECONCILE_GRACE_MINUTES * 60_000);
    const stuck = await this.paymentsRepo.findStuckTimedOut(cutoff);

    for (const payment of stuck) {
      const session = await this.stripe.checkout.sessions.retrieve(payment.stripeSessionId);

      if (session.payment_status === 'paid') {
        const updated = await this.paymentsRepo.update(payment.id, {
          status: PaymentStatus.SUCCEEDED,
          stripePaymentId: session.payment_intent as string,
        });
        await this.reservationsService.confirmPayment(updated.reservationId);
      } else {
        const updated = await this.paymentsRepo.update(payment.id, {
          status: PaymentStatus.DECLINED,
        });
        const reservation = await this.reservationsService.getById(updated.reservationId);
        await this.paymentAbuse.recordFailure(reservation.userId);
      }
    }
  }
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Write the failing cron test**

Add to `backend/src/cron/test/hold-expiry.cron.spec.ts`:

```typescript
import { PaymentsService } from '../../payments/payments.service';

const mockPaymentsService = { reconcileTimedOutPayments: jest.fn() };
```

Add `{ provide: PaymentsService, useValue: mockPaymentsService }` to the `providers` array in
`beforeEach`, and:

```typescript
  it('calls PaymentsService.reconcileTimedOutPayments', async () => {
    mockPaymentsService.reconcileTimedOutPayments.mockResolvedValue(undefined);

    await cron.handleReconcilePayments();

    expect(mockPaymentsService.reconcileTimedOutPayments).toHaveBeenCalledTimes(1);
  });

  it('swallows a reconciliation failure instead of throwing', async () => {
    mockPaymentsService.reconcileTimedOutPayments.mockRejectedValue(new Error('Stripe down'));

    await expect(cron.handleReconcilePayments()).resolves.toBeUndefined();
  });
```

- [ ] **Step 6: Run the test, confirm it fails**

Run: `cd backend && npx jest hold-expiry.cron.spec.ts`
Expected: FAIL — `cron.handleReconcilePayments is not a function`.

- [ ] **Step 7: Implement the cron trigger and wire the module**

```typescript
// backend/src/cron/hold-expiry.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservationsService } from '../reservations/reservations.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class HoldExpiryCron {
  private readonly logger = new Logger(HoldExpiryCron.name);

  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpireHolds(): Promise<void> {
    try {
      await this.reservationsService.expireHolds();
    } catch (err) {
      this.logger.error('expireHolds tick failed', err as Error);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleReconcilePayments(): Promise<void> {
    try {
      await this.paymentsService.reconcileTimedOutPayments();
    } catch (err) {
      this.logger.error('reconcileTimedOutPayments tick failed', err as Error);
    }
  }
}
```

```typescript
// backend/src/cron/cron.module.ts
import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { PaymentsModule } from '../payments/payments.module';
import { HoldExpiryCron } from './hold-expiry.cron';

@Module({
  imports: [ReservationsModule, PaymentsModule],
  providers: [HoldExpiryCron],
})
export class CronModule {}
```

- [ ] **Step 8: Run the tests, confirm they pass**

Run: `cd backend && npx jest hold-expiry.cron.spec.ts payments.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 9: Full suite + build one more time**

Run: `cd backend && npx jest && npx nest build`
Expected: PASS / no errors — this is the last code task, so it's the final "everything compiles and every
test passes" checkpoint.

- [ ] **Step 10: Commit**

```bash
git add backend/src/payments/payments.service.ts backend/src/payments/test/payments.service.spec.ts backend/src/cron
git commit -m "feat(payments): payment-reconciliation cron, every 5 minutes"
```

---

## Task 15: Manual end-to-end smoke test (not automated — needs your Stripe test account)

**Files:** none — this is a manual verification pass using the Stripe CLI, not a code task.

- [ ] **Step 1: Start the stack**

Run: `cd backend && npm run docker:up:dev` (Postgres + Redis), then `npm run start:dev` in one terminal.

- [ ] **Step 2: Forward webhooks locally**

Run in a second terminal: `stripe listen --forward-to localhost:3000/api/v1/payments/webhook` — copy the
printed `whsec_...` into `backend/.env`'s `STRIPE_WEBHOOK_SECRET` if it differs from what's already there,
restart `start:dev` if you changed it.

- [ ] **Step 3: Walk the happy path**

1. `POST /api/v1/auth/login` (or however you get a session) → get a JWT cookie.
2. `POST /api/v1/reservations` with `{ screeningId, seatId }` → get back a `HELD` reservation.
3. `POST /api/v1/payments/checkout-session` with `{ reservationId }` → get `{ url }`.
4. Open `url` in a browser, pay with Stripe's test card `4242 4242 4242 4242`, any future expiry/CVC.
5. Watch the `stripe listen` terminal — confirm a `checkout.session.completed` event fires and your
   backend logs show no errors.
6. `GET /api/v1/payments/reservations/:reservationId/status` → confirm `{ reservationStatus: "CONFIRMED",
   paymentStatus: "SUCCEEDED" }`.

- [ ] **Step 4: Walk the cancel/refund path**

1. Reserve + pay for a second seat (screening far enough in the future to land in the 100% refund
   bucket — >48h out).
2. `DELETE /api/v1/reservations/:id` on the now-`CONFIRMED` reservation.
3. Confirm a `200` with the reservation now `CANCELLED`, and in the Stripe Dashboard (Payments → the test
   charge) confirm a refund was issued for the full amount.

- [ ] **Step 5: Report back**

Tell me what broke, if anything — this step exists to catch integration issues (webhook routing, raw
body parsing, CORS on the Checkout redirect) that unit tests with mocked Stripe can't catch.

---

## Self-Review Notes

- **Spec coverage:** every "In:" scope item from the design doc maps to a task (checkout: Task 9;
  webhook: Task 10; refund: Task 11; lockout: Tasks 6-7; broadcast: Task 13; cron: Task 14; single-seat
  companion change: Tasks 3-5). The three "Out:" items (multi-currency, multi-seat, refund-amount audit
  column) are correctly not built.
- **Type consistency:** `ReservationChangedPayload` (`{screeningId, seatIds: number[]}`) is reused as-is
  for `RESERVATION_CONFIRMED` — no new payload shape needed since a single-seat reservation still fits
  `seatIds: [seatId]`. `PaymentsService` method names (`createCheckoutSession`, `handleWebhookEvent`,
  `refundReservation`, `reconcileTimedOutPayments`, `getStatus`) are consistent between where they're
  defined (Tasks 9-12, 14) and where they're called (`ReservationsService.cancel()` in Task 11,
  `HoldExpiryCron` in Task 14, `PaymentsController` in Task 12).
- **No placeholders:** every step has real, complete code — nothing marked TBD or "add error handling"
  without showing it.
