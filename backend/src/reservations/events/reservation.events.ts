/**
 * Reservation domain events (in-process, via `@nestjs/event-emitter`).
 *
 * Consumed by the cache-invalidation listener (reservations module) and the
 * WebSocket broadcast listener (gateway module).
 */
export const RESERVATION_CREATED = 'reservation.created';
export const RESERVATION_CANCELLED = 'reservation.cancelled';
export const RESERVATION_CONFIRMED = 'reservation.confirmed';

/** Payload for every `reservation.*` event: the affected screening and seats. */
export interface ReservationChangedPayload {
  screeningId: number;
  seatIds: number[];
}
