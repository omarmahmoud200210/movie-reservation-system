import { Injectable } from '@nestjs/common';
import RedisCache from './redis.cache';
import { randomUUID } from 'node:crypto';

export interface RateLimiterConfig {
  windowSize: number;
  maxRequests: number;
}

export interface RateLimiterResult {
  allowed: boolean;
  remaining: number;
  resetAfterMs: number;
}

@Injectable()
export default class RateLimiterService {
  constructor(private readonly redis: RedisCache) {}

  private getClient() {
    return this.redis.getClient();
  }

  async rateLimiter(
    key: string,
    config: RateLimiterConfig,
  ): Promise<RateLimiterResult> {
    const client = this.getClient();
    const timestamp = Date.now();
    const windowStart = timestamp - config.windowSize;

    const multi = await client
      .multi()
      .zremrangebyscore(key, 0, windowStart)
      .zcard(key)
      .zadd(key, timestamp, randomUUID())
      .pexpire(key, config.windowSize)
      .exec();

    if (!Array.isArray(multi)) {
      throw new Error('Failed to execute Redis pipeline');
    }

    const count = Number(multi[1][1]);
    const allowed = count < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - count - 1);

    // TODO: Get an accurate retry in ms

    if (!allowed) {
      return {
        allowed: false,
        remaining: 0,
        resetAfterMs: config.windowSize,
      };
    }

    return {
      allowed: true,
      remaining: remaining,
      resetAfterMs: config.windowSize,
    };
  }
}
