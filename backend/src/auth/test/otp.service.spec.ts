import { Test, TestingModule } from '@nestjs/testing';

// Modules...
import { OtpService } from '../otp.service';
import RedisCache from '../../redis/redis.cache';

// Mocks...
const mockRedisCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  pipeline: jest.fn().mockReturnThis(),
  incr: jest.fn(),
};

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: RedisCache, useValue: mockRedisCache },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  describe('Generate OTP', () => {
    it('should generate a 6-digit OTP', () => {
      const otp = service['gen']();
      expect(otp).toHaveLength(6);
      expect(otp).toMatch(/^[0-9]+$/);
    });
  });

  describe('Issue OTP', () => {
    it('should issue an OTP and set cooldown', async () => {
      const email = '[EMAIL_ADDRESS]';
      process.env.OTP_TTL_SECONDS = '600';
      process.env.OTP_RESEND_COOLDOWN_SECONDS = '60';
      mockRedisCache.get.mockResolvedValue(null);
      mockRedisCache.pipeline.mockImplementation(() => ({
        set: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([null, null, null]),
      }));

      const otp = await service.issue(email);

      expect(otp).toHaveLength(6);
      expect(mockRedisCache.pipeline).toHaveBeenCalled();
      expect(mockRedisCache.get).toHaveBeenCalledWith(`otp_cooldown:${email}`);
    });
  });

  describe('Verify OTP', () => {
    it('should verify OTP successfully', async () => {
      const email = '[EMAIL_ADDRESS]';
      const code = '123456';
      mockRedisCache.get.mockResolvedValue(code);
      mockRedisCache.incr.mockResolvedValue(1);
      mockRedisCache.del.mockResolvedValue(1);

      const result = await service.verify(email, code);

      expect(result).toBe(true);
      expect(mockRedisCache.get).toHaveBeenCalledWith(`otp:${email}`);
      expect(mockRedisCache.incr).toHaveBeenCalledWith(`otp_attempts:${email}`);
      expect(mockRedisCache.del).toHaveBeenCalledWith(`otp:${email}`);
      expect(mockRedisCache.del).toHaveBeenCalledWith(`otp_attempts:${email}`);
    });

    it('should return false for invalid OTP', async () => {
      const email = '[EMAIL_ADDRESS]';
      const code = '123456';
      mockRedisCache.get.mockResolvedValue('654321');

      const result = await service.verify(email, code);

      expect(result).toBe(false);
    });

    it('should throw error for too many attempts', async () => {
      const email = '[EMAIL_ADDRESS]';
      const code = '123456';
      process.env.OTP_MAX_ATTEMPTS = '5';
      mockRedisCache.get.mockResolvedValue(code);
      mockRedisCache.incr.mockResolvedValue(6);

      await expect(service.verify(email, code)).rejects.toThrow(
        'Too many attempts',
      );
      expect(mockRedisCache.del).toHaveBeenCalledWith(`otp:${email}`);
    });
  });
});
