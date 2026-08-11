import RateLimiterService from '../rate-limiter.service';
import RedisCache from '../redis.cache';
import { randomUUID } from 'node:crypto';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

const mockEval = jest.fn();
const mockClient = { eval: mockEval };

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let mockRedisCache: jest.Mocked<RedisCache>;

  beforeEach(() => {
    jest.clearAllMocks();
    (randomUUID as jest.Mock).mockReturnValue('fixed-uuid');
    mockRedisCache = {
      getClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<RedisCache>;
    service = new RateLimiterService(mockRedisCache);
  });

  it('calls eval with the script, 1 key, the key, a timestamp, windowSize, maxRequests, and a random member', async () => {
    mockEval.mockResolvedValue([1, 2, 60000]);

    await service.rateLimiter('test-key', {
      windowSize: 60000,
      maxRequests: 5,
    });

    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'test-key',
      expect.any(Number),
      60000,
      5,
      'fixed-uuid',
    );
  });

  it('maps an allowed script reply to the correct result', async () => {
    mockEval.mockResolvedValue([1, 2, 60000]);

    const result = await service.rateLimiter('test-key', {
      windowSize: 60000,
      maxRequests: 5,
    });

    expect(result).toEqual({
      allowed: true,
      remaining: 2,
      resetAfterMs: 60000,
    });
  });

  it('maps a blocked script reply to the correct result', async () => {
    mockEval.mockResolvedValue([0, 0, 15000]);

    const result = await service.rateLimiter('test-key', {
      windowSize: 60000,
      maxRequests: 5,
    });

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      resetAfterMs: 15000,
    });
  });
});
