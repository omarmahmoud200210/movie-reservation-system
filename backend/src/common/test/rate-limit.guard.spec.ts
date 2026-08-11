import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { RateLimitGuard } from '../guards/rate-limit.guard';
import {
  RATE_LIMIT_KEY,
  RateLimitConfig,
} from '../decorators/rate-limit.decorator';
import RateLimiterService from '../../redis/rate-limiter.service';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockRateLimiterService: jest.Mocked<RateLimiterService>;
  let mockRequest: { user?: { id: number } };
  let mockResponse: { setHeader: jest.Mock };
  let mockContext: jest.Mocked<ExecutionContext>;

  beforeEach(async () => {
    mockRequest = {};
    mockResponse = { setHeader: jest.fn() };
    mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as jest.Mocked<ExecutionContext>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
        {
          provide: RateLimiterService,
          useValue: { rateLimiter: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<RateLimitGuard>(RateLimitGuard);
    mockReflector = module.get(Reflector);
    mockRateLimiterService = module.get(RateLimiterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when no @RateLimit metadata is present', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(mockRateLimiterService.rateLimiter).not.toHaveBeenCalled();
  });

  it('calls rateLimiter with the correct key and config when allowed', async () => {
    const config: RateLimitConfig = {
      points: 5,
      duration: 60000,
      key: 'test-endpoint',
    };
    mockReflector.getAllAndOverride.mockReturnValue(config);
    mockRequest.user = { id: 42 };
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAfterMs: 50000,
    });

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(mockRateLimiterService.rateLimiter).toHaveBeenCalledTimes(1);
    expect(mockRateLimiterService.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:user:42:test-endpoint',
      { windowSize: 60000, maxRequests: 5 },
    );
  });

  it('throws HttpException(429) and sets Retry-After header when rate limited', async () => {
    const config: RateLimitConfig = {
      points: 3,
      duration: 30000,
      key: 'login',
    };
    mockReflector.getAllAndOverride.mockReturnValue(config);
    mockRequest.user = { id: 99 };
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAfterMs: 15000,
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      new HttpException(
        'Too many requests, please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', 15);
  });
});
