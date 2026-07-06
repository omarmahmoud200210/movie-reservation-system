import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import RateLimiterService from '../../redis/rate-limiter.service';

@Injectable()
export class IpRateLimitMiddleware implements NestMiddleware {
  private readonly rules: Record<
    string,
    { points: number; duration: number; key: string }
  > = {
    'POST /auth/login': { points: 5, duration: 15 * 60_000, key: 'auth:login' },
    'GET /movies': { points: 60, duration: 60_000, key: 'movies:browse' },
  };

  constructor(private readonly rateLimiterService: RateLimiterService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const routeKey = `${req.method} ${req.path}`;
    const rule = this.rules[routeKey];

    if (!rule) {
      next();
      return;
    }

    const redisKey = `rate_limit:ip:${req.ip}:${rule.key}`;
    const result = await this.rateLimiterService.rateLimiter(redisKey, {
      windowSize: rule.duration,
      maxRequests: rule.points,
    });

    if (!result.allowed) {
      res.setHeader('Retry-After', Math.ceil(result.resetAfterMs / 1000));
      res.status(429).json({
        statusCode: 429,
        message: 'Too many requests, please try again later',
      });
      return;
    }

    next();
  }
}
