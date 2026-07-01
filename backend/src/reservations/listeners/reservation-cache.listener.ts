import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ScreeningsCache } from '../../screenings/screenings.cache';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CREATED,
  type ReservationChangedPayload,
} from '../events/reservation.events';

/**
 * Keeps `seat_map:screening:{id}` fresh after a reservation changes. Reserve and
 * cancel both fire `reservation.*`; this drops the cached map so the next
 * seat-map read recomputes from the DB.
 *
 * DEFERRED(phase-5): the WebSocket broadcast listener subscribes to these same
 * events to push `seat:reserved` / `seat:cancelled` to the screening room.
 */
@Injectable()
export class ReservationCacheListener {
  constructor(private readonly screeningsCache: ScreeningsCache) {}

  @OnEvent(RESERVATION_CREATED)
  @OnEvent(RESERVATION_CANCELLED)
  async invalidateSeatMap(payload: ReservationChangedPayload): Promise<void> {
    await this.screeningsCache.delSeatMap(payload.screeningId);
  }
}
