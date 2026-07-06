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

const RATE_LIMITER_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowSize = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local member = ARGV[4]

local windowStart = now - windowSize

redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

local count = redis.call('ZCARD', key)

if count < maxRequests then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowSize)
  local remaining = maxRequests - count - 1
  return {1, remaining, windowSize}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAfterMs = 0
  if #oldest >= 2 then
    resetAfterMs = (tonumber(oldest[2]) + windowSize) - now
    if resetAfterMs < 0 then resetAfterMs = 0 end
  end
  return {0, 0, resetAfterMs}
end
`;

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
    const member = randomUUID();

    const result = await client.eval(
      RATE_LIMITER_SCRIPT,
      1,
      key,
      timestamp,
      config.windowSize,
      config.maxRequests,
      member,
    );

    const [allowedFlag, remaining, resetAfterMs] = result as [number, number, number];

    return {
      allowed: allowedFlag === 1,
      remaining,
      resetAfterMs,
    };
  }
}
