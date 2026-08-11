import { Test, TestingModule } from '@nestjs/testing';

// Modules...
import { OtpService } from '../otp.service';
import RedisCache from '../../redis/redis.cache';

// Mocks...
const mockPipeline = {
  set: jest.fn().mockReturnThis(),
  del: jest.fn().mockReturnThis(),
  incr: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([[null, 1]]),
};

const mockRedisCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  pipeline: jest.fn().mockReturnValue(mockPipeline),
  incr: jest.fn(),
};

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisCache.pipeline.mockReturnValue(mockPipeline);
    mockPipeline.set.mockReturnThis();
    mockPipeline.del.mockReturnThis();
    mockPipeline.incr.mockReturnThis();
    mockPipeline.expire.mockReturnThis();
    mockPipeline.exec.mockResolvedValue([[null, 1]]);

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
      const email = 'john@example.com';
      mockRedisCache.get.mockResolvedValue(null);

      const otp = await service.issue(email);

      expect(otp).toHaveLength(6);
      expect(mockRedisCache.pipeline).toHaveBeenCalled();
      expect(mockRedisCache.get).toHaveBeenCalledWith(`otp_cooldown:${email}`);
    });
  });

  describe('Verify OTP', () => {
    it('should verify OTP successfully', async () => {
      const email = 'john@example.com';
      const code = '123456';
      mockRedisCache.get.mockResolvedValue(code);
      mockPipeline.exec.mockResolvedValue([[null, 1]]);

      const result = await service.verify(email, code);

      expect(result).toBe(true);
      expect(mockRedisCache.get).toHaveBeenCalledWith(`otp:${email}`);
      expect(mockPipeline.incr).toHaveBeenCalledWith(`otp_attempts:${email}`);
      expect(mockRedisCache.del).toHaveBeenCalledWith(`otp:${email}`);
      expect(mockRedisCache.del).toHaveBeenCalledWith(`otp_attempts:${email}`);
    });

    it('should return false for invalid OTP', async () => {
      const email = 'john@example.com';
      const code = '123456';
      mockRedisCache.get.mockResolvedValue('654321');
      mockPipeline.exec.mockResolvedValue([[null, 1]]);

      const result = await service.verify(email, code);

      expect(result).toBe(false);
    });

    it('should throw error for too many attempts', async () => {
      const email = 'john@example.com';
      const code = '123456';
      mockRedisCache.get.mockResolvedValue(code);
      mockPipeline.exec.mockResolvedValue([[null, 6]]);

      await expect(service.verify(email, code)).rejects.toThrow(
        'Too many attempts',
      );
      expect(mockRedisCache.del).toHaveBeenCalledWith(`otp:${email}`);
    });
  });
});
