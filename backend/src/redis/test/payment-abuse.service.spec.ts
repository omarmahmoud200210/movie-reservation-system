import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import PaymentAbuseService from '../payment-abuse.service';
import RedisCache from '../redis.cache';

const mockClient = {
  zadd: jest.fn(),
  pexpire: jest.fn(),
  zremrangebyscore: jest.fn(),
  zcard: jest.fn(),
  set: jest.fn(),
  exists: jest.fn(),
};
const mockRedisCache = { getClient: () => mockClient };
const mockLockoutsCounter = { inc: jest.fn() };

describe('PaymentAbuseService', () => {
  let service: PaymentAbuseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-07T12:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentAbuseService,
        { provide: RedisCache, useValue: mockRedisCache },
        {
          provide: getToken('payment_abuse_lockouts_total'),
          useValue: mockLockoutsCounter,
        },
      ],
    }).compile();

    service = module.get<PaymentAbuseService>(PaymentAbuseService);
  });

  afterEach(() => jest.useRealTimers());

  describe('recordFailure', () => {
    it('adds a failure and does not lock out under 3', async () => {
      mockClient.zcard.mockResolvedValue(2);

      await service.recordFailure(7);

      expect(mockClient.zadd).toHaveBeenCalledWith(
        'payment_failures:user:7',
        expect.any(Number),
        expect.any(String),
      );
      expect(mockClient.set).not.toHaveBeenCalled();
    });

    it('sets a 30min lockout key on the 3rd failure within the window', async () => {
      mockClient.zcard.mockResolvedValue(3);

      await service.recordFailure(7);

      expect(mockClient.set).toHaveBeenCalledWith(
        'payment_lockout:user:7',
        '1',
        'PX',
        30 * 60_000,
      );
    });

    it('sets the failures key to expire after the 24h window', async () => {
      mockClient.zcard.mockResolvedValue(1);

      await service.recordFailure(7);

      expect(mockClient.pexpire).toHaveBeenCalledWith(
        'payment_failures:user:7',
        24 * 60 * 60_000,
      );
    });

    it('prunes failures older than 24h before counting', async () => {
      mockClient.zcard.mockResolvedValue(1);
      const now = Date.now();

      await service.recordFailure(7);

      expect(mockClient.zremrangebyscore).toHaveBeenCalledWith(
        'payment_failures:user:7',
        0,
        now - 24 * 60 * 60_000,
      );
    });

    it('increments payment_abuse_lockouts_total only on the 3rd failure', async () => {
      mockClient.zcard.mockResolvedValue(2);
      await service.recordFailure(7);
      expect(mockLockoutsCounter.inc).not.toHaveBeenCalled();

      mockClient.zcard.mockResolvedValue(3);
      await service.recordFailure(7);
      expect(mockLockoutsCounter.inc).toHaveBeenCalledTimes(1);
    });
  });

  describe('isLockedOut', () => {
    it('returns true when the lockout key exists', async () => {
      mockClient.exists.mockResolvedValue(1);

      await expect(service.isLockedOut(7)).resolves.toBe(true);
      expect(mockClient.exists).toHaveBeenCalledWith('payment_lockout:user:7');
    });

    it('returns false when the lockout key is absent', async () => {
      mockClient.exists.mockResolvedValue(0);

      await expect(service.isLockedOut(7)).resolves.toBe(false);
    });
  });
});
