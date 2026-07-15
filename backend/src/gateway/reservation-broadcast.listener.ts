import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SeatStatus } from '@prisma/client';
import { ScreeningGateway } from './screening.gateway';
import { ScreeningsService } from '../screenings/screenings.service';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CREATED,
  RESERVATION_CONFIRMED,
  RESERVATION_HOLD_EXPIRED,
  type HoldExpiredPayload,
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
    @InjectMetric('websocket_broadcasts_total')
    private readonly broadcastsCounter: Counter<string>,
  ) {}

  @OnEvent(RESERVATION_CREATED)
  async handleCreated(payload: ReservationChangedPayload): Promise<void> {
    await this.broadcast(payload, 'seat:reserved', SeatStatus.HELD);
  }

  @OnEvent(RESERVATION_CANCELLED)
  async handleCancelled(payload: ReservationChangedPayload): Promise<void> {
    await this.broadcast(payload, 'seat:cancelled', SeatStatus.AVAILABLE);
  }

  @OnEvent(RESERVATION_CONFIRMED)
  async handleConfirmed(payload: ReservationChangedPayload): Promise<void> {
    await this.broadcast(payload, 'seat:booked', SeatStatus.BOOKED);
  }

  @OnEvent(RESERVATION_HOLD_EXPIRED)
  handleHoldExpired(payload: HoldExpiredPayload): void {
    this.broadcastsCounter.inc({ event: 'hold:expired' });
    try {
      this.gateway.emitToUser(payload.userId, 'hold:expired', {
        screeningId: payload.screeningId,
        seatId: payload.seatId,
      });
    } catch (err) {
      this.logger.warn(`hold:expired broadcast failed: ${String(err)}`);
    }
  }

  private async broadcast(
    payload: ReservationChangedPayload,
    event: string,
    status: SeatStatus,
  ): Promise<void> {
    this.broadcastsCounter.inc({ event });

    try {
      this.gateway.emitToRoom(payload.screeningId, event, {
        screeningId: payload.screeningId,
        seatIds: payload.seatIds,
        status,
      });
    } catch (err) {
      this.logger.warn(`${event} broadcast failed: ${String(err)}`);
    }

    // Note: this reads the same seat-map cache that ReservationCacheListener
    // invalidates on the same event, with no ordering guarantee between the
    // two listeners (EventEmitter2 doesn't await one against the other). A
    // stale read here is self-healing — the next reservation event recomputes
    // correctly, and the seat-delta above is always accurate since it comes
    // from the event payload, not the cache — so this is an accepted,
    // documented risk rather than a bug to eliminate.
    try {
      const summary = await this.screeningsService.getScreeningSummary(
        payload.screeningId,
      );
      this.gateway.emitToRoom(
        payload.screeningId,
        'screening:summary',
        summary,
      );
    } catch (err) {
      this.logger.warn(`screening:summary broadcast failed: ${String(err)}`);
    }
  }
}
