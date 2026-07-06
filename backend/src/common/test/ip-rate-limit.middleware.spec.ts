import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response, NextFunction } from 'express';

import { IpRateLimitMiddleware } from '../middleware/ip-rate-limit.middleware';
import RateLimiterService from '../../redis/rate-limiter.service';

function buildReq(method: string, path: string, ip = ''): Request {
  return { method, path, ip } as unknown as Request;
}

function buildRes() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('IpRateLimitMiddleware', () => {
  let middleware: IpRateLimitMiddleware;
  let mockRateLimiterService: jest.Mocked<RateLimiterService>;
  let mockRes: ReturnType<typeof buildRes>;
  let mockNext: jest.Mock;

  beforeEach(async () => {
    mockRes = buildRes();
    mockNext = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpRateLimitMiddleware,
        { provide: RateLimiterService, useValue: { rateLimiter: jest.fn() } },
      ],
    }).compile();

    middleware = module.get<IpRateLimitMiddleware>(IpRateLimitMiddleware);
    mockRateLimiterService = module.get(
      RateLimiterService,
    ) as jest.Mocked<RateLimiterService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() without calling rateLimiter for an unmatched route', async () => {
    const req = buildReq('GET', '/auth/login');

    await middleware.use(
      req,
      mockRes as unknown as Response,
      mockNext as unknown as NextFunction,
    );

    expect(mockRateLimiterService.rateLimiter).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('allows POST /auth/login within limits', async () => {
    const req = buildReq('POST', '/auth/login', '1.2.3.4');
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAfterMs: 800_000,
    });

    await middleware.use(
      req,
      mockRes as unknown as Response,
      mockNext as unknown as NextFunction,
    );

    expect(mockRateLimiterService.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:ip:1.2.3.4:auth:login',
      { windowSize: 900_000, maxRequests: 5 },
    );
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('allows GET /movies within limits', async () => {
    const req = buildReq('GET', '/movies', '1.2.3.4');
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAfterMs: 55_000,
    });

    await middleware.use(
      req,
      mockRes as unknown as Response,
      mockNext as unknown as NextFunction,
    );

    expect(mockRateLimiterService.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:ip:1.2.3.4:movies:browse',
      { windowSize: 60_000, maxRequests: 60 },
    );
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('blocks and returns 429 when rate limited', async () => {
    const req = buildReq('POST', '/auth/login', '1.2.3.4');
    mockRateLimiterService.rateLimiter.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAfterMs: 12_500,
    });

    await middleware.use(
      req,
      mockRes as unknown as Response,
      mockNext as unknown as NextFunction,
    );

    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', 13);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many requests, please try again later',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });
});
