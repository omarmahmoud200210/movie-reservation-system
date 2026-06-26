import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export default class RedisCache implements OnModuleDestroy, OnModuleInit {
  private redis: Redis;
  private readonly logger = new Logger(RedisCache.name);

  constructor() {}

  onModuleInit() {
    this.redis = new Redis({
      host: process.env.REDIS_CACHE_HOST ?? 'localhost',
      port: Number(process.env.REDIS_CACHE_PORT ?? 6379),
    });

    this.redis.on('connect', () => this.logger.log('Redis Caching connected'));
    this.redis.on('error', (err) =>
      this.logger.error('Redis Caching error', err),
    );
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  getClient(): Redis {
    return this.redis;
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  // Permissive args to support ioredis option tuples, e.g. set(key, val, 'EX', ttl).
  set(
    key: string,
    value: string | number,
    ...args: unknown[]
  ): Promise<'OK' | null> {
    return (this.redis.set as (...a: unknown[]) => Promise<'OK' | null>)(
      key,
      value,
      ...args,
    );
  }

  del(...keys: string[]): Promise<number> {
    return this.redis.del(...keys);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  // For batching independent commands into a single round-trip.
  pipeline(): ReturnType<Redis['pipeline']> {
    return this.redis.pipeline();
  }
}
