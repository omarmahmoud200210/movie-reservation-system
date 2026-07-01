/**
 * Reservation domain events (in-process, via `@nestjs/event-emitter`).
 *
 * This phase has a single listener — cache invalidation of the screening seat
 * map. The names + payload live here so the phase-5 WebSocket broadcast listener
 * can subscribe to the same constants without duplicating string literals.
 */
export const RESERVATION_CREATED = 'reservation.created';
export const RESERVATION_CANCELLED = 'reservation.cancelled';

/** Payload for every `reservation.*` event: the affected screening. */
export interface ReservationChangedPayload {
  screeningId: number;
}
