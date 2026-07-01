import { Test, TestingModule } from '@nestjs/testing';
import { ReservationCacheListener } from '../listeners/reservation-cache.listener';
import { ScreeningsCache } from '../../screenings/screenings.cache';

const mockScreeningsCache = { delSeatMap: jest.fn() };

describe('ReservationCacheListener', () => {
  let listener: ReservationCacheListener;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationCacheListener,
        { provide: ScreeningsCache, useValue: mockScreeningsCache },
      ],
    }).compile();

    listener = module.get<ReservationCacheListener>(ReservationCacheListener);
  });

  it('invalidates the seat map for the payload screening', async () => {
    await listener.invalidateSeatMap({ screeningId: 42 });

    expect(mockScreeningsCache.delSeatMap).toHaveBeenCalledWith(42);
  });

  it('subscribes to both reservation.created and reservation.cancelled', () => {
    const events = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.invalidateSeatMap,
    ) as Array<{ event: string }>;

    expect(events.map((e) => e.event).sort()).toEqual([
      'reservation.cancelled',
      'reservation.created',
    ]);
  });
});
