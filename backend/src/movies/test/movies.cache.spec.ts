import { Test, TestingModule } from '@nestjs/testing';
import { MoviesCache } from '../movies.cache';
import RedisCache from '../../redis/redis.cache';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const movie = { id: 1, name: 'Inception', status: 'PUBLISHED' };

describe('MoviesCache', () => {
  let cache: MoviesCache;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MoviesCache, { provide: RedisCache, useValue: mockRedis }],
    }).compile();

    cache = module.get<MoviesCache>(MoviesCache);
  });

  describe('getMovie', () => {
    it('parses the cached JSON on a hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(movie));

      await expect(cache.getMovie(1)).resolves.toEqual(movie);
      expect(mockRedis.get).toHaveBeenCalledWith('movie:1');
    });

    it('returns null on a miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(cache.getMovie(1)).resolves.toBeNull();
    });

    it('degrades to null (no throw) on a Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('redis down'));

      await expect(cache.getMovie(1)).resolves.toBeNull();
    });
  });

  describe('setMovie', () => {
    it('stores the movie JSON with a 1h TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await cache.setMovie(movie as never);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'movie:1',
        JSON.stringify(movie),
        'EX',
        3600,
      );
    });

    it('swallows Redis errors', async () => {
      mockRedis.set.mockRejectedValue(new Error('redis down'));

      await expect(cache.setMovie(movie as never)).resolves.toBeUndefined();
    });
  });

  describe('delMovie', () => {
    it('deletes the movie key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await cache.delMovie(1);

      expect(mockRedis.del).toHaveBeenCalledWith('movie:1');
    });

    it('swallows Redis errors', async () => {
      mockRedis.del.mockRejectedValue(new Error('redis down'));

      await expect(cache.delMovie(1)).resolves.toBeUndefined();
    });
  });

  describe('getLists', () => {
    it('returns both lists when both keys are present', async () => {
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(
          key === 'movies:now_showing'
            ? JSON.stringify([movie])
            : JSON.stringify([]),
        ),
      );

      await expect(cache.getLists()).resolves.toEqual({
        nowShowing: [movie],
        comingSoon: [],
      });
    });

    it('treats a missing key as a miss (null)', async () => {
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'movies:now_showing' ? JSON.stringify([]) : null),
      );

      await expect(cache.getLists()).resolves.toBeNull();
    });

    it('degrades to null on a Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('redis down'));

      await expect(cache.getLists()).resolves.toBeNull();
    });
  });

  describe('setLists', () => {
    it('stores both list keys with a 60s TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await cache.setLists({ nowShowing: [movie as never], comingSoon: [] });

      expect(mockRedis.set).toHaveBeenCalledWith(
        'movies:now_showing',
        JSON.stringify([movie]),
        'EX',
        60,
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'movies:coming_soon',
        JSON.stringify([]),
        'EX',
        60,
      );
    });
  });

  describe('delLists', () => {
    it('deletes both list keys in one call', async () => {
      mockRedis.del.mockResolvedValue(2);

      await cache.delLists();

      expect(mockRedis.del).toHaveBeenCalledWith(
        'movies:now_showing',
        'movies:coming_soon',
      );
    });
  });
});
