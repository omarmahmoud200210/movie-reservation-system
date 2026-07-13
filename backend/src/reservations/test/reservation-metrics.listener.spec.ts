import { ReservationMetricsListener } from '../listeners/reservation-metrics.listener';

const mockCreatedCounter = { inc: jest.fn() };
const mockCancelledCounter = { inc: jest.fn() };
const mockConfirmedCounter = { inc: jest.fn() };
const mockHeldGauge = { inc: jest.fn(), dec: jest.fn() };

describe('ReservationMetricsListener', () => {
  let listener: ReservationMetricsListener;

  beforeEach(() => {
    jest.clearAllMocks();
    listener = new ReservationMetricsListener(
      mockCreatedCounter as never,
      mockCancelledCounter as never,
      mockConfirmedCounter as never,
      mockHeldGauge as never,
    );
  });

  it('handleCreated increments the created counter and the held gauge', () => {
    listener.handleCreated({ screeningId: 3, seatIds: [11] });

    expect(mockCreatedCounter.inc).toHaveBeenCalledTimes(1);
    expect(mockHeldGauge.inc).toHaveBeenCalledTimes(1);
  });

  it('handleCancelled increments the cancelled counter and decrements the held gauge', () => {
    listener.handleCancelled({ screeningId: 3, seatIds: [11] });

    expect(mockCancelledCounter.inc).toHaveBeenCalledTimes(1);
    expect(mockHeldGauge.dec).toHaveBeenCalledTimes(1);
  });

  it('handleConfirmed increments the confirmed counter and decrements the held gauge', () => {
    listener.handleConfirmed({ screeningId: 3, seatIds: [11] });

    expect(mockConfirmedCounter.inc).toHaveBeenCalledTimes(1);
    expect(mockHeldGauge.dec).toHaveBeenCalledTimes(1);
  });

  it('subscribes each handler to the matching reservation event', () => {
    const createdEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCreated,
    ) as Array<{ event: string }>;
    const cancelledEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCancelled,
    ) as Array<{ event: string }>;
    const confirmedEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleConfirmed,
    ) as Array<{ event: string }>;

    expect(createdEvents.map((e) => e.event)).toEqual(['reservation.created']);
    expect(cancelledEvents.map((e) => e.event)).toEqual([
      'reservation.cancelled',
    ]);
    expect(confirmedEvents.map((e) => e.event)).toEqual([
      'reservation.confirmed',
    ]);
  });
});
