import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import RedisCache from './redis.cache';

const WINDOW_MS = 24 * 60 * 60_000;
const LOCKOUT_MS = 30 * 60_000;
const FAILURE_THRESHOLD = 3;

/**
 * Payment-abuse lockout: 3 failed/declined payments in a rolling 24h window
 * blocks new reservation creation for 30 min. Plain ioredis calls (not the
 * Lua-script pattern RateLimiterService uses) — this only *sets* a lockout
 * once a threshold is crossed and *reads* a single key to check it, no
 * admit/reject decision under contention. Two concurrent recordFailure calls
 * for the same user can each read a stale zcard before the other's zadd is
 * visible, delaying the lockout by at most one extra failure — self-healing
 * on the next call, not a security gap.
 */
@Injectable()
export default class PaymentAbuseService {
  constructor(private readonly redis: RedisCache) {}

  async recordFailure(userId: number): Promise<void> {
    const key = `payment_failures:user:${userId}`;
    const now = Date.now();
    const client = this.redis.getClient();
    await client.zadd(key, now, `${now}-${randomUUID()}`);
    await client.pexpire(key, WINDOW_MS);
    await client.zremrangebyscore(key, 0, now - WINDOW_MS);
    const count = await client.zcard(key);
    if (count >= FAILURE_THRESHOLD) {
      await client.set(`payment_lockout:user:${userId}`, '1', 'PX', LOCKOUT_MS);
    }
  }

  async isLockedOut(userId: number): Promise<boolean> {
    const client = this.redis.getClient();
    return (await client.exists(`payment_lockout:user:${userId}`)) === 1;
  }
}
