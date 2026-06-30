import { Test, TestingModule } from '@nestjs/testing';
import { SeatStatus } from '@prisma/client';
import { ScreeningsCache } from '../screenings.cache';
import RedisCache from '../../redis/redis.cache';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const seatMap = [
  { seatId: 1, row: 'A', number: '1', status: SeatStatus.AVAILABLE },
  { seatId: 2, row: 'A', number: '2', status: SeatStatus.HELD },
];

describe('ScreeningsCache', () => {
  let cache: ScreeningsCache;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreeningsCache,
        { provide: RedisCache, useValue: mockRedis },
      ],
    }).compile();

    cache = module.get<ScreeningsCache>(ScreeningsCache);
  });

  describe('getSeatMap', () => {
    it('parses the cached JSON on a hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(seatMap));

      await expect(cache.getSeatMap(10)).resolves.toEqual(seatMap);
      expect(mockRedis.get).toHaveBeenCalledWith('seat_map:screening:10');
    });

    it('returns null on a miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(cache.getSeatMap(10)).resolves.toBeNull();
    });

    it('degrades to null (no throw) on a Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('redis down'));

      await expect(cache.getSeatMap(10)).resolves.toBeNull();
    });
  });

  describe('setSeatMap', () => {
    it('stores the seat map with a 5m TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await cache.setSeatMap(10, seatMap);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'seat_map:screening:10',
        JSON.stringify(seatMap),
        'EX',
        300,
      );
    });

    it('swallows Redis errors', async () => {
      mockRedis.set.mockRejectedValue(new Error('redis down'));

      await expect(cache.setSeatMap(10, seatMap)).resolves.toBeUndefined();
    });
  });

  describe('delSeatMap', () => {
    it('deletes the seat-map key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await cache.delSeatMap(10);

      expect(mockRedis.del).toHaveBeenCalledWith('seat_map:screening:10');
    });

    it('swallows Redis errors', async () => {
      mockRedis.del.mockRejectedValue(new Error('redis down'));

      await expect(cache.delSeatMap(10)).resolves.toBeUndefined();
    });
  });
});
