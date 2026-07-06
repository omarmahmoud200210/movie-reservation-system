import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response, NextFunction } from 'express';

import { IpRateLimitMiddleware } from '../middleware/ip-rate-limit.middleware';
import RateLimiterService from '../../redis/rate-limiter.service';

describe('IpRateLimitMiddleware', () => {
  let middleware: IpRateLimitMiddleware;
  let mockRateLimiterService: jest.Mocked<RateLimiterService>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Record<'setHeader' | 'status' | 'json', jest.Mock>>;
  let mockNext: jest.Mock;

  beforeEach(async () => {
    mockReq = { method: '', path: '', ip: '' };
    mockRes = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpRateLimitMiddleware,
        { provide: RateLimiterService, useValue: { rateLimiter: jest.fn() } },
      ],
    }).compile();

    middleware = module.get<IpRateLimitMiddleware>(IpRateLimitMiddleware);
    mockRateLimiterService = module.get(RateLimiterService) as jest.Mocked<RateLimiterService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() without calling rateLimiter for an unmatched route', async () => {
    mockReq.method = 'GET';
    mockReq.path = '/auth/login';

    await middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRateLimiterService.rateLimiter).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('allows POST /auth/login within limits', async () => {
    mockReq.method = 'POST';
    mockReq.path = '/auth/login';
    mockReq.ip = '1.2.3.4';
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAfterMs: 800_000,
    });

    await middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRateLimiterService.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:ip:1.2.3.4:auth:login',
      { windowSize: 900_000, maxRequests: 5 },
    );
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('allows GET /movies within limits', async () => {
    mockReq.method = 'GET';
    mockReq.path = '/movies';
    mockReq.ip = '1.2.3.4';
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAfterMs: 55_000,
    });

    await middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRateLimiterService.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:ip:1.2.3.4:movies:browse',
      { windowSize: 60_000, maxRequests: 60 },
    );
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('blocks and returns 429 when rate limited', async () => {
    mockReq.method = 'POST';
    mockReq.path = '/auth/login';
    mockReq.ip = '1.2.3.4';
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAfterMs: 12_500,
    });

    await middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', 13);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many requests, please try again later',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });
});
