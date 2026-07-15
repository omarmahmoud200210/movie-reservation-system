/**
 * Reservation domain events (in-process, via `@nestjs/event-emitter`).
 *
 * Consumed by the cache-invalidation listener (reservations module) and the
 * WebSocket broadcast listener (gateway module).
 */
export const RESERVATION_CREATED = 'reservation.created';
export const RESERVATION_CANCELLED = 'reservation.cancelled';
export const RESERVATION_CONFIRMED = 'reservation.confirmed';

/** Emitted once per released reservation from a hold-expiry sweep, for a
 * direct per-holder notification (distinct from the room-wide
 * `reservation.cancelled` broadcast, which is unchanged). */
export const RESERVATION_HOLD_EXPIRED = 'reservation.hold_expired';

/** Payload for every `reservation.*` event: the affected screening and seats. */
export interface ReservationChangedPayload {
  screeningId: number;
  seatIds: number[];
}

export interface HoldExpiredPayload {
  userId: number;
  screeningId: number;
  seatId: number;
}
