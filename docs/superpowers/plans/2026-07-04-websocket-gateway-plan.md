# WebSocket Gateway — Real-Time Seat Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broadcast live seat-status changes and a derived screening summary (held/booked/available/reserved counts) to every visitor watching a screening, driven by the reservations module's existing `reservation.created` / `reservation.cancelled` events.

**Architecture:** A new `src/gateway/` module holds a Socket.io `ScreeningGateway` (room-per-screening, public/read-only, no WS auth) and a `ReservationBroadcastListener` that subscribes to the existing reservation events and pushes `seat:reserved` / `seat:cancelled` / `screening:summary` to the room. The summary is derived from `ScreeningsService`'s existing cache-aside seat map — no new Redis structures. The reservation event payload is enriched with `seatIds` so the listener knows what changed.

**Tech Stack:** NestJS, `@nestjs/websockets` + `@nestjs/platform-socket.io` (already installed, default `IoAdapter` auto-loads — no `main.ts` change needed), `@nestjs/event-emitter`, Jest + `@nestjs/testing`.

**Spec:** `docs/superpowers/specs/2026-07-03-websocket-gateway-design.md`

---

## Before you start

Read `docs/superpowers/specs/2026-07-03-websocket-gateway-design.md` in full. Key decisions already made (don't re-litigate):
- **No WebSocket authentication this phase.** The gateway is public/read-only; the only mutating action (reserve/cancel) is already guarded over HTTP. Socket identity is deferred to phase 7 via a `DEFERRED(phase-7)` marker.
- **`join:screening` uses an ack callback**, not a separate `seat:initial_state` emit. Returning a plain object from a `@SubscribeMessage` handler auto-invokes the client's ack callback with that object (verified against `node_modules/@nestjs/platform-socket.io/adapters/io-adapter.js` — no special decorator needed).
- **The summary is derived from the existing seat-map cache** (`ScreeningsService.getSeatMap`), not a new Redis counter.

---

## Task 1: Enrich the reservation event payload with `seatIds`

**Files:**
- Modify: `backend/src/reservations/events/reservation.events.ts`
- Modify: `backend/src/reservations/test/reservation-cache.listener.spec.ts:23-27`

- [x] **Step 1: Update the failing/changed test first**

In `backend/src/reservations/test/reservation-cache.listener.spec.ts`, change the payload literal at line 24 to include `seatIds` (the listener ignores it, but the type will require it):

```ts
  it('invalidates the seat map for the payload screening', async () => {
    await listener.invalidateSeatMap({ screeningId: 42, seatIds: [1, 2] });

    expect(mockScreeningsCache.delSeatMap).toHaveBeenCalledWith(42);
  });
```

- [x] **Step 2: Run the test to see the current type error / behavior**

Run: `cd backend && npx jest reservation-cache.listener.spec.ts`
Expected: still PASSES right now (payload type isn't enforced until Step 3 changes the interface) — this step just gets the test file into its final shape before the type change.

- [x] **Step 3: Add `seatIds` to the payload type**

In `backend/src/reservations/events/reservation.events.ts`, replace the whole file:

```ts
/**
 * Reservation domain events (in-process, via `@nestjs/event-emitter`).
 *
 * Consumed by the cache-invalidation listener (reservations module) and the
 * WebSocket broadcast listener (gateway module).
 */
export const RESERVATION_CREATED = 'reservation.created';
export const RESERVATION_CANCELLED = 'reservation.cancelled';

/** Payload for every `reservation.*` event: the affected screening and seats. */
export interface ReservationChangedPayload {
  screeningId: number;
  seatIds: number[];
}
```

- [x] **Step 4: Run the full reservations test suite to confirm nothing else broke**

Run: `cd backend && npx jest reservations`
Expected: FAIL — `reservations.service.spec.ts` assertions on `mockEvents.emit` still expect the old 2-field payload shape (compiles fine since those are separate literals in `toHaveBeenCalledWith`, but will now mismatch actual calls once Task 2/3 change the emit calls). At this point (before Task 2/3), it should still PASS, since `reservations.service.ts` hasn't changed yet. Confirm: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/src/reservations/events/reservation.events.ts backend/src/reservations/test/reservation-cache.listener.spec.ts
git commit -m "feat(reservations): add seatIds to the reservation.* event payload"
```

---

## Task 2: Emit `seatIds` from `ReservationsService.reserve`

**Files:**
- Modify: `backend/src/reservations/reservations.service.ts:31-59`
- Modify: `backend/src/reservations/test/reservations.service.spec.ts:89-98`

- [x] **Step 1: Update the test to expect `seatIds` in the emitted event**

In `backend/src/reservations/test/reservations.service.spec.ts`, replace the `'emits reservation.created...'` test (lines 89–98):

```ts
    it('emits reservation.created with the screening id and held seat ids', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeats.mockResolvedValue([
        { id: 100, seatId: 11 },
        { id: 101, seatId: 12 },
      ]);

      await service.reserve(7, dto);

      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CREATED, {
        screeningId: 3,
        seatIds: [11, 12],
      });
    });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest reservations.service.spec.ts -t "emits reservation.created"`
Expected: FAIL — actual call was `{ screeningId: 3 }`, missing `seatIds`.

- [x] **Step 3: Update `reserve()` to emit `seatIds`**

In `backend/src/reservations/reservations.service.ts`, replace the `emit` line inside `reserve` (currently line 57):

```ts
    const reservations = await this.reservationsRepo.holdSeats({
      userId,
      screeningId: dto.screeningId,
      hallId: screening.hallId,
      seatIds,
      heldUntil,
    });

    this.events.emit(RESERVATION_CREATED, {
      screeningId: dto.screeningId,
      seatIds: reservations.map((r) => r.seatId),
    });
    return reservations;
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest reservations.service.spec.ts`
Expected: PASS (all tests in the file, including the one from Step 1).

- [x] **Step 5: Commit**

```bash
git add backend/src/reservations/reservations.service.ts backend/src/reservations/test/reservations.service.spec.ts
git commit -m "feat(reservations): emit held seatIds on reservation.created"
```

---

## Task 3: Emit `seatIds` from `ReservationsService.cancel`

**Files:**
- Modify: `backend/src/reservations/reservations.service.ts:61-81`
- Modify: `backend/src/reservations/test/reservations.service.spec.ts:153-167`

- [x] **Step 1: Update the test to expect `seatIds` in the emitted event**

In `backend/src/reservations/test/reservations.service.spec.ts`, replace the `'cancels a HELD reservation...'` test (lines 153–167):

```ts
    it('cancels a HELD reservation owned by the caller and emits', async () => {
      mockReservationsRepo.findById.mockResolvedValue(held);
      const cancelled = { ...held, status: ReservationStatus.CANCELLED };
      mockReservationsRepo.setStatus.mockResolvedValue(cancelled);

      await expect(service.cancel(7, 100)).resolves.toBe(cancelled);

      expect(mockReservationsRepo.setStatus).toHaveBeenCalledWith(
        100,
        ReservationStatus.CANCELLED,
      );
      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CANCELLED, {
        screeningId: 3,
        seatIds: [11],
      });
    });
```

(`held.seatId` is already `11` per the fixture at line 149 — no fixture change needed.)

- [x] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest reservations.service.spec.ts -t "cancels a HELD reservation"`
Expected: FAIL — actual call was `{ screeningId: 3 }`, missing `seatIds`.

- [x] **Step 3: Update `cancel()` to emit `seatIds`**

In `backend/src/reservations/reservations.service.ts`, replace the `emit` line inside `cancel` (currently line 77):

```ts
    const cancelled = await this.reservationsRepo.setStatus(
      id,
      ReservationStatus.CANCELLED,
    );
    this.events.emit(RESERVATION_CANCELLED, {
      screeningId: reservation.screeningId,
      seatIds: [reservation.seatId],
    });
    return cancelled;
```

- [x] **Step 4: Run the full reservations suite to verify everything passes**

Run: `cd backend && npx jest reservations`
Expected: PASS — all reservations tests (service, controller, repository, cache listener) green.

- [x] **Step 5: Commit**

```bash
git add backend/src/reservations/reservations.service.ts backend/src/reservations/test/reservations.service.spec.ts
git commit -m "feat(reservations): emit cancelled seatId on reservation.cancelled"
```

---

## Task 4: Add `ScreeningsService.getScreeningSummary`

**Files:**
- Modify: `backend/src/screenings/screenings.service.ts`
- Modify: `backend/src/screenings/test/screenings.service.spec.ts`

- [x] **Step 1: Write the failing tests**

In `backend/src/screenings/test/screenings.service.spec.ts`, add a new `describe` block right after the existing `describe('getSeatMap', ...)` block (i.e. before the `describe('caching', ...)` block, around line 418):

```ts
  describe('getScreeningSummary', () => {
    beforeEach(() => {
      mockScreeningsCache.getSeatMap.mockResolvedValue(null);
    });

    it('derives capacity/held/booked/available/reserved from the seat map', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.findSeatsByHall.mockResolvedValue([
        { id: 100, hallId: 2, row: 'A', number: '1' },
        { id: 101, hallId: 2, row: 'A', number: '2' },
        { id: 102, hallId: 2, row: 'A', number: '3' },
        { id: 103, hallId: 2, row: 'A', number: '4' },
      ]);
      mockScreeningsRepo.findActiveReservations.mockResolvedValue([
        { seatId: 100, status: ReservationStatus.HELD },
        { seatId: 101, status: ReservationStatus.CONFIRMED },
      ]);

      await expect(service.getScreeningSummary(10)).resolves.toEqual({
        screeningId: 10,
        capacity: 4,
        held: 1,
        booked: 1,
        available: 2,
        reserved: 2,
      });
    });

    it('reads from the warm seat-map cache without hitting the DB', async () => {
      mockScreeningsCache.getSeatMap.mockResolvedValue([
        { seatId: 1, row: 'A', number: '1', status: SeatStatus.AVAILABLE },
      ]);

      await expect(service.getScreeningSummary(10)).resolves.toEqual({
        screeningId: 10,
        capacity: 1,
        held: 0,
        booked: 0,
        available: 1,
        reserved: 0,
      });
      expect(mockScreeningsRepo.findById).not.toHaveBeenCalled();
    });

    it('throws 404 for a cancelled/unknown screening (propagated from getSeatMap)', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.getScreeningSummary(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest screenings.service.spec.ts -t "getScreeningSummary"`
Expected: FAIL with `service.getScreeningSummary is not a function`.

- [x] **Step 3: Implement `getScreeningSummary`**

In `backend/src/screenings/screenings.service.ts`, add the `ScreeningSummary` interface next to `SeatMapEntry` (after line 31):

```ts
/** Derived counts for a screening, used by the live seat-updates broadcast. */
export interface ScreeningSummary {
  screeningId: number;
  capacity: number;
  held: number;
  booked: number;
  available: number;
  reserved: number;
}
```

Then add the method to `ScreeningsService`, right after `getSeatMap` (after line 188, before `toSeatStatus`):

```ts
  /**
   * Derived seat counts for a screening — held/booked/available/reserved.
   * Reuses `getSeatMap`'s cache-aside read; no separate Redis structure, so
   * this can never drift from the seat map (both invalidate together).
   *
   * DEFERRED(phase-11): if load testing shows this recompute-on-broadcast is
   * a real hotspot, replace with an atomic Redis counter (HINCRBY on
   * reserve/cancel) instead of guessing now.
   */
  async getScreeningSummary(screeningId: number): Promise<ScreeningSummary> {
    const seatMap = await this.getSeatMap(screeningId);

    let held = 0;
    let booked = 0;
    for (const seat of seatMap) {
      if (seat.status === SeatStatus.HELD) held++;
      else if (seat.status === SeatStatus.BOOKED) booked++;
    }

    const capacity = seatMap.length;
    return {
      screeningId,
      capacity,
      held,
      booked,
      available: capacity - held - booked,
      reserved: held + booked,
    };
  }
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest screenings.service.spec.ts`
Expected: PASS — all tests in the file, including the new `getScreeningSummary` block.

- [x] **Step 5: Commit**

```bash
git add backend/src/screenings/screenings.service.ts backend/src/screenings/test/screenings.service.spec.ts
git commit -m "feat(screenings): add getScreeningSummary derived from the seat-map cache"
```

---

## Task 5: Create the `ScreeningGateway` (connection + `join:screening` ack)

**Files:**
- Create: `backend/src/gateway/screening.gateway.ts`
- Create: `backend/src/gateway/gateway.module.ts`
- Create: `backend/src/gateway/test/screening.gateway.spec.ts`

- [x] **Step 1: Write the failing tests**

Create `backend/src/gateway/test/screening.gateway.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Socket, Server } from 'socket.io';
import { ScreeningGateway } from '../screening.gateway';
import { ScreeningsService } from '../../screenings/screenings.service';

const mockScreeningsService = {
  getSeatMap: jest.fn(),
  getScreeningSummary: jest.fn(),
};

function mockClient(): jest.Mocked<Pick<Socket, 'join'>> {
  return { join: jest.fn() };
}

describe('ScreeningGateway', () => {
  let gateway: ScreeningGateway;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreeningGateway,
        { provide: ScreeningsService, useValue: mockScreeningsService },
      ],
    }).compile();

    gateway = module.get<ScreeningGateway>(ScreeningGateway);
  });

  describe('handleConnection', () => {
    it('accepts every connection (no auth this phase)', () => {
      const client = mockClient() as unknown as Socket;
      expect(() => gateway.handleConnection(client)).not.toThrow();
    });
  });

  describe('handleJoin', () => {
    it('joins the screening room and acks the seat map + summary', async () => {
      const seats = [{ seatId: 1, row: 'A', number: '1', status: 'AVAILABLE' }];
      const summary = {
        screeningId: 10,
        capacity: 1,
        held: 0,
        booked: 0,
        available: 1,
        reserved: 0,
      };
      mockScreeningsService.getSeatMap.mockResolvedValue(seats);
      mockScreeningsService.getScreeningSummary.mockResolvedValue(summary);
      const client = mockClient();

      const ack = await gateway.handleJoin(
        { screeningId: 10 },
        client as unknown as Socket,
      );

      expect(client.join).toHaveBeenCalledWith('screening:10');
      expect(ack).toEqual({ ok: true, seats, summary });
    });

    it('acks ok:false and does not join when the screening is unknown/cancelled', async () => {
      mockScreeningsService.getSeatMap.mockRejectedValue(
        new NotFoundException('Screening 99 not found'),
      );
      const client = mockClient();

      const ack = await gateway.handleJoin(
        { screeningId: 99 },
        client as unknown as Socket,
      );

      expect(ack).toEqual({ ok: false, error: 'Screening 99 not found' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('acks ok:false without calling the service for a malformed screeningId', async () => {
      const client = mockClient();

      const ack = await gateway.handleJoin(
        { screeningId: NaN },
        client as unknown as Socket,
      );

      expect(ack).toEqual({ ok: false, error: 'Invalid screeningId' });
      expect(mockScreeningsService.getSeatMap).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rethrows unexpected (non-NotFound) errors', async () => {
      mockScreeningsService.getSeatMap.mockRejectedValue(new Error('DB down'));
      const client = mockClient();

      await expect(
        gateway.handleJoin({ screeningId: 10 }, client as unknown as Socket),
      ).rejects.toThrow('DB down');
    });
  });

  describe('emitToRoom', () => {
    it('emits the event to the screening room', () => {
      const mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
      gateway.server = mockServer as unknown as Server;

      gateway.emitToRoom(10, 'seat:reserved', { foo: 'bar' });

      expect(mockServer.to).toHaveBeenCalledWith('screening:10');
      expect(mockServer.emit).toHaveBeenCalledWith('seat:reserved', {
        foo: 'bar',
      });
    });
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest screening.gateway.spec.ts`
Expected: FAIL — `Cannot find module '../screening.gateway'`.

- [x] **Step 3: Implement `ScreeningGateway`**

Create `backend/src/gateway/screening.gateway.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
// Note: @ConnectedSocket()/@MessageBody() only resolve inside @SubscribeMessage
// handlers (Nest's RPC argument pipeline). handleConnection is invoked directly
// by the OnGatewayConnection lifecycle hook, so its parameter is undecorated.
import {
  ScreeningsService,
  type ScreeningSummary,
  type SeatMapEntry,
} from '../screenings/screenings.service';

type JoinScreeningResult =
  | { ok: true; seats: SeatMapEntry[]; summary: ScreeningSummary }
  | { ok: false; error: string };

const roomName = (screeningId: number) => `screening:${screeningId}`;

/**
 * Public, read-only real-time layer: broadcasts seat/summary changes to every
 * visitor watching a screening. No WS auth — the only mutating action
 * (reserve/cancel) is already guarded over HTTP; this gateway only pushes
 * state, it never accepts one.
 */
@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL } })
export class ScreeningGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly screeningsService: ScreeningsService) {}

  handleConnection(client: Socket): void {
    // DEFERRED(phase-7): attach holder identity here (verify the httpOnly
    // access_token cookie via JwtService) once per-holder hold-expiry
    // notifications need to target a specific socket. Requires re-enabling
    // `credentials: true` in the gateway's CORS options above.
    void client;
  }

  @SubscribeMessage('join:screening')
  async handleJoin(
    @MessageBody() data: { screeningId: number },
    @ConnectedSocket() client: Socket,
  ): Promise<JoinScreeningResult> {
    const screeningId = Number(data?.screeningId);
    if (!Number.isInteger(screeningId) || screeningId < 1) {
      return { ok: false, error: 'Invalid screeningId' };
    }

    try {
      const seats = await this.screeningsService.getSeatMap(screeningId);
      const summary =
        await this.screeningsService.getScreeningSummary(screeningId);
      client.join(roomName(screeningId));
      return { ok: true, seats, summary };
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

  // DEFERRED(phase-7): subscribe to the Redis Pub/Sub `seat:hold_expired`
  // channel here (published by the phase-6 cron job) and call emitToRoom to
  // broadcast it, plus a direct emit to the holder's socket (see the
  // handleConnection marker above for where that identity gets attached).

  emitToRoom(screeningId: number, event: string, payload: unknown): void {
    this.server.to(roomName(screeningId)).emit(event, payload);
  }
}
```

- [x] **Step 4: Create the module**

Create `backend/src/gateway/gateway.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ScreeningGateway } from './screening.gateway';

/**
 * Real-time seat-updates gateway. Imports ScreeningsModule for the seat map +
 * summary reads used by `join:screening` and the broadcast listener (added in
 * a later task). Public/read-only — no auth module needed this phase.
 */
@Module({
  imports: [ScreeningsModule],
  providers: [ScreeningGateway],
  exports: [ScreeningGateway],
})
export class GatewayModule {}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest screening.gateway.spec.ts`
Expected: PASS — all 6 tests green.

- [x] **Step 6: Commit**

```bash
git add backend/src/gateway/screening.gateway.ts backend/src/gateway/gateway.module.ts backend/src/gateway/test/screening.gateway.spec.ts
git commit -m "feat(gateway): add ScreeningGateway with public join:screening ack"
```

---

## Task 6: Create `ReservationBroadcastListener`

**Files:**
- Create: `backend/src/gateway/reservation-broadcast.listener.ts`
- Create: `backend/src/gateway/test/reservation-broadcast.listener.spec.ts`
- Modify: `backend/src/gateway/gateway.module.ts`

- [x] **Step 1: Write the failing tests**

Create `backend/src/gateway/test/reservation-broadcast.listener.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { SeatStatus } from '@prisma/client';
import { ReservationBroadcastListener } from '../reservation-broadcast.listener';
import { ScreeningGateway } from '../screening.gateway';
import { ScreeningsService } from '../../screenings/screenings.service';

const mockGateway = { emitToRoom: jest.fn() };
const mockScreeningsService = { getScreeningSummary: jest.fn() };

const summary = {
  screeningId: 10,
  capacity: 4,
  held: 1,
  booked: 0,
  available: 3,
  reserved: 1,
};

describe('ReservationBroadcastListener', () => {
  let listener: ReservationBroadcastListener;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockScreeningsService.getScreeningSummary.mockResolvedValue(summary);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationBroadcastListener,
        { provide: ScreeningGateway, useValue: mockGateway },
        { provide: ScreeningsService, useValue: mockScreeningsService },
      ],
    }).compile();

    listener = module.get<ReservationBroadcastListener>(
      ReservationBroadcastListener,
    );
  });

  describe('handleCreated', () => {
    it('broadcasts seat:reserved with HELD status and the screening summary', async () => {
      await listener.handleCreated({ screeningId: 10, seatIds: [1, 2] });

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'seat:reserved',
        { screeningId: 10, seatIds: [1, 2], status: SeatStatus.HELD },
      );
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'screening:summary',
        summary,
      );
    });

    it('still broadcasts the seat delta when the summary computation fails', async () => {
      mockScreeningsService.getScreeningSummary.mockRejectedValue(
        new Error('cache down'),
      );

      await expect(
        listener.handleCreated({ screeningId: 10, seatIds: [1] }),
      ).resolves.toBeUndefined();

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'seat:reserved',
        { screeningId: 10, seatIds: [1], status: SeatStatus.HELD },
      );
      expect(mockGateway.emitToRoom).not.toHaveBeenCalledWith(
        10,
        'screening:summary',
        expect.anything(),
      );
    });

    it('swallows a failing emit instead of throwing', async () => {
      mockGateway.emitToRoom.mockImplementationOnce(() => {
        throw new Error('socket error');
      });

      await expect(
        listener.handleCreated({ screeningId: 10, seatIds: [1] }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleCancelled', () => {
    it('broadcasts seat:cancelled with AVAILABLE status and the screening summary', async () => {
      await listener.handleCancelled({ screeningId: 10, seatIds: [1] });

      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'seat:cancelled',
        { screeningId: 10, seatIds: [1], status: SeatStatus.AVAILABLE },
      );
      expect(mockGateway.emitToRoom).toHaveBeenCalledWith(
        10,
        'screening:summary',
        summary,
      );
    });
  });

  it('subscribes handleCreated to reservation.created and handleCancelled to reservation.cancelled', () => {
    const createdEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCreated,
    ) as Array<{ event: string }>;
    const cancelledEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCancelled,
    ) as Array<{ event: string }>;

    expect(createdEvents.map((e) => e.event)).toEqual(['reservation.created']);
    expect(cancelledEvents.map((e) => e.event)).toEqual([
      'reservation.cancelled',
    ]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest reservation-broadcast.listener.spec.ts`
Expected: FAIL — `Cannot find module '../reservation-broadcast.listener'`.

- [x] **Step 3: Implement `ReservationBroadcastListener`**

Create `backend/src/gateway/reservation-broadcast.listener.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SeatStatus } from '@prisma/client';
import { ScreeningGateway } from './screening.gateway';
import { ScreeningsService } from '../screenings/screenings.service';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CREATED,
  type ReservationChangedPayload,
} from '../reservations/events/reservation.events';

/**
 * Pushes live seat-status changes to the screening's WebSocket room. Second
 * listener on the same `reservation.*` events the cache-invalidation listener
 * uses (reservations module) — resolves the `DEFERRED(phase-5)` marker left
 * there. A failed broadcast is logged, never thrown: it must not break the
 * HTTP reserve/cancel request that triggered it.
 */
@Injectable()
export class ReservationBroadcastListener {
  private readonly logger = new Logger(ReservationBroadcastListener.name);

  constructor(
    private readonly gateway: ScreeningGateway,
    private readonly screeningsService: ScreeningsService,
  ) {}

  @OnEvent(RESERVATION_CREATED)
  async handleCreated(payload: ReservationChangedPayload): Promise<void> {
    await this.broadcast(payload, 'seat:reserved', SeatStatus.HELD);
  }

  @OnEvent(RESERVATION_CANCELLED)
  async handleCancelled(payload: ReservationChangedPayload): Promise<void> {
    await this.broadcast(payload, 'seat:cancelled', SeatStatus.AVAILABLE);
  }

  // DEFERRED(phase-9): once payment confirmation exists, a HELD -> CONFIRMED
  // transition needs its own broadcast branch here mapping to a `seat:booked`
  // event with SeatStatus.BOOKED — this listener currently only distinguishes
  // HELD (created) vs AVAILABLE (cancelled).

  private async broadcast(
    payload: ReservationChangedPayload,
    event: string,
    status: SeatStatus,
  ): Promise<void> {
    try {
      this.gateway.emitToRoom(payload.screeningId, event, {
        screeningId: payload.screeningId,
        seatIds: payload.seatIds,
        status,
      });
    } catch (err) {
      this.logger.warn(`${event} broadcast failed: ${String(err)}`);
    }

    try {
      const summary = await this.screeningsService.getScreeningSummary(
        payload.screeningId,
      );
      this.gateway.emitToRoom(payload.screeningId, 'screening:summary', summary);
    } catch (err) {
      this.logger.warn(`screening:summary broadcast failed: ${String(err)}`);
    }
  }
}
```

- [x] **Step 4: Resolve the stale `DEFERRED(phase-5)` marker in the reservations module**

`backend/src/reservations/listeners/reservation-cache.listener.ts` carries a
comment reserving this exact listener slot. Now that it's built, update the
comment so it doesn't read as still-open. Replace the class docstring:

```ts
/**
 * Keeps `seat_map:screening:{id}` fresh after a reservation changes. Reserve and
 * cancel both fire `reservation.*`; this drops the cached map so the next
 * seat-map read recomputes from the DB.
 *
 * A second listener, `ReservationBroadcastListener` (src/gateway/), subscribes
 * to the same events to push `seat:reserved` / `seat:cancelled` to the
 * screening's WebSocket room.
 */
```

(This replaces the old `DEFERRED(phase-5): the WebSocket broadcast listener
subscribes...` line — the seam it reserved is now built, so the comment
should describe what exists, not what's still missing.)

- [x] **Step 5: Register the listener in `GatewayModule`**

Modify `backend/src/gateway/gateway.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ScreeningGateway } from './screening.gateway';
import { ReservationBroadcastListener } from './reservation-broadcast.listener';

/**
 * Real-time seat-updates gateway. Imports ScreeningsModule for the seat map +
 * summary reads used by `join:screening` and the broadcast listener.
 * `EventEmitterModule` is global, so no explicit import for the listener.
 * Public/read-only — no auth module needed this phase.
 */
@Module({
  imports: [ScreeningsModule],
  providers: [ScreeningGateway, ReservationBroadcastListener],
  exports: [ScreeningGateway],
})
export class GatewayModule {}
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx jest reservation-broadcast.listener.spec.ts`
Expected: PASS — all tests green.

Also run: `cd backend && npx jest reservation-cache.listener.spec.ts`
Expected: PASS — Step 4's docstring-only change doesn't affect behavior.

- [x] **Step 7: Commit**

```bash
git add backend/src/gateway/reservation-broadcast.listener.ts backend/src/gateway/gateway.module.ts backend/src/gateway/test/reservation-broadcast.listener.spec.ts backend/src/reservations/listeners/reservation-cache.listener.ts
git commit -m "feat(gateway): broadcast seat deltas and summary on reservation events"
```

---

## Task 7: Register `GatewayModule` in `AppModule`

**Files:**
- Modify: `backend/src/app.module.ts`

- [x] **Step 1: Add the import**

Replace `backend/src/app.module.ts` in full:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailerModule } from './mailer/mailer.module';
import { AuthModule } from './auth/auth.module';
import { MoviesModule } from './movies/movies.module';
import { ScreeningsModule } from './screenings/screenings.module';
import { ReservationsModule } from './reservations/reservations.module';
import { GatewayModule } from './gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
    MailerModule,
    AuthModule,
    MoviesModule,
    ScreeningsModule,
    ReservationsModule,
    GatewayModule,
  ],
})
export class AppModule {}
```

- [x] **Step 2: Verify the app still boots and the full test suite passes**

Run: `cd backend && npx jest`
Expected: PASS — every existing suite plus the new gateway tests, no regressions.

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no type errors.

- [x] **Step 3: Commit**

```bash
git add backend/src/app.module.ts
git commit -m "feat(gateway): register GatewayModule in AppModule"
```

---

## Task 8: Sync `architecture.md` §3 (Real-Time Layer) with the implementation

**Files:**
- Modify: `architecture.md:73-96`

- [x] **Step 1: Replace the Real-Time Layer section**

The Build Order's phase 13 entry was already added and committed in an earlier session (commit `bffdbd8`). This step adds the §3 rewrite on top of it.

Replace lines 73–96 of `architecture.md` (the `### 3. Real-Time Layer (WebSocket Gateway)` section) with:

```markdown
### 3. Real-Time Layer (WebSocket Gateway)

**Protocol:** Socket.io over WSS
**Room naming:** `screening:{screening_id}`

**Access:** Public and read-only. Every visitor — logged in or not — can
connect and receive live seat/summary updates. There is no WS authentication:
the only mutating action (reserve/cancel) happens over the already-guarded
HTTP API, so there is nothing on the socket to authorize. (A prior version of
this doc specified a hard `WsJwtGuard` on every connection — dropped because
the seat map is already public over HTTP, and gating its live version would
be inconsistent. Socket identity returns in the pub/sub phase below, for
per-holder targeting only.)

**Event Contract**

| Event | Direction | Payload |
|---|---|---|
| `join:screening` | Client → Server | `{ screening_id }`, ack response: `{ ok: true, seats, summary }` or `{ ok: false, error }` |
| `seat:reserved` | Server → Room | `{ screening_id, seat_ids, status: 'HELD' }` |
| `seat:cancelled` | Server → Room | `{ screening_id, seat_ids, status: 'AVAILABLE' }` |
| `screening:summary` | Server → Room | `{ screening_id, capacity, held, booked, available, reserved }` |

`join:screening` returns the initial seat map + summary via its **ack
callback**, tying the response to that specific request — no separate
`seat:initial_state` emit and no ambiguous global `error` event.

**Summary derivation**
`screening:summary` is not a separate Redis counter — it's derived on every
broadcast from the same cache-aside seat map (`seat_map:screening:{id}`) the
HTTP seat-map endpoint already uses, so it can never drift from it. Revisit
with an atomic Redis counter only if load testing (phase 11) shows this
recompute is a real hotspot.

**Reconnection Flow**
Socket.io auto-reconnects with exponential backoff.
On every `connect` event (first connect + reconnects), client re-emits
`join:screening` and gets a fresh ack — full resync, no server-side state to
recover.
```

- [x] **Step 2: Verify the diff**

Run (from the repo root of your workspace): `git diff -- architecture.md`
Expected: shows only the new §3 rewrite (the phase-13 build-order addition is
already committed as of `bffdbd8`), with no leftover references to
`handshake.auth.token`, `WsJwtGuard`, or `seat:initial_state` as a separate
emit.

- [x] **Step 3: Commit**

```bash
git add architecture.md
git commit -m "docs: sync architecture.md with the public/read-only WebSocket gateway"
```

---

## Task 9: Full verification pass

**Files:** none (verification only)

- [x] **Step 1: Run the entire backend test suite**

Run: `cd backend && npx jest`
Expected: every suite passes, including:
- `reservations/test/*.spec.ts`
- `screenings/test/screenings.service.spec.ts`
- `gateway/test/screening.gateway.spec.ts`
- `gateway/test/reservation-broadcast.listener.spec.ts`

- [x] **Step 2: Type-check the whole project**

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no errors.

- [x] **Step 3: Grep for the deferred markers this phase introduced/resolved**

Run: `cd backend && grep -rn "DEFERRED(phase-" src`
Expected output includes four new markers left by this phase, all in
`src/gateway/`:
```
src/gateway/screening.gateway.ts:              // DEFERRED(phase-7): attach holder identity...
src/gateway/screening.gateway.ts:              // DEFERRED(phase-7): subscribe to the Redis Pub/Sub...
src/gateway/reservation-broadcast.listener.ts: // DEFERRED(phase-9): once payment confirmation exists...
src/screenings/screenings.service.ts:          * DEFERRED(phase-11): if load testing shows...
```
plus the pre-existing markers from earlier phases (`reservations.service.ts`
phase-6/phase-9, `reservations.controller.ts` phase-8). The old
`DEFERRED(phase-5)` marker in `reservation-cache.listener.ts` should **not**
appear — Task 6 Step 4 replaced it with a plain docstring, since that seam is
now built rather than pending.

- [x] **Step 4: Boot the app and confirm the gateway registers without error**

Run: `cd backend && npm run start:dev` (or `npx nest start`), watch the log
Expected: app starts on the configured port with no `GatewayModule` /
`ScreeningGateway` errors. Stop it after confirming (`Ctrl+C`).

If the user wants a live manual check (connecting a Socket.io client and
watching `join:screening` + a real reserve/cancel broadcast), do that next
with their input on which screening/user to use — this step only confirms the
module wires up cleanly.
