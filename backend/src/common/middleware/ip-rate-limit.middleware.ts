import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import RateLimiterService from '../../redis/rate-limiter.service';

@Injectable()
export class IpRateLimitMiddleware implements NestMiddleware {
  private readonly rules: Record<
    string,
    { points: number; duration: number; key: string }
  > = {
    'POST /auth/login': {
      points: Number(process.env.LOGIN_RATE_LIMIT) || 5,
      duration: 15 * 60_000,
      key: 'auth:login',
    },
    'GET /movies': { points: 60, duration: 60_000, key: 'movies:browse' },
    'POST /auth/register': {
      points: 3,
      duration: 60_000,
      key: 'auth:register',
    },
    'POST /auth/verify-otp': {
      points: 10,
      duration: 60_000,
      key: 'auth:verify-otp',
    },
    'POST /auth/resend-otp': {
      points: 3,
      duration: 60_000,
      key: 'auth:resend-otp',
    },
    'POST /auth/refresh': { points: 10, duration: 60_000, key: 'auth:refresh' },
  };

  constructor(private readonly rateLimiterService: RateLimiterService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // With the app's global prefix (api/v1) applied by Nest, Express's
    // req.path includes the prefix while the rules below are keyed on the
    // controller-relative path. Strip the prefix so `POST /api/v1/auth/login`
    // matches the `POST /auth/login` rule; routes without the prefix are
    // matched as-is (so unit tests with bare paths keep working).
    const routePath = req.path.startsWith('/api/v1')
      ? req.path.slice('/api/v1'.length)
      : req.path;
    const routeKey = `${req.method} ${routePath}`;
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
