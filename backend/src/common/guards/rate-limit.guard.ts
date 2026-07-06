import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RATE_LIMIT_KEY, RateLimitConfig } from '../decorators/rate-limit.decorator';
import RateLimiterService from '../../redis/rate-limiter.service';
import { AuthUser } from '../../auth/token.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<RateLimitConfig>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUser | undefined;

    const redisKey = `rate_limit:user:${user?.id}:${config.key}`;

    const result = await this.rateLimiterService.rateLimiter(redisKey, {
      windowSize: config.duration,
      maxRequests: config.points,
    });

    if (!result.allowed) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('Retry-After', Math.ceil(result.resetAfterMs / 1000));
      throw new HttpException(
        'Too many requests, please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
