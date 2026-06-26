import { Global, Module } from '@nestjs/common';
import RedisCache from './redis.cache';
import RedisPubSub from './redis.pubsub';
import RateLimiterService from './rate-limiter.service';
@Global()
@Module({
  providers: [RedisCache, RedisPubSub, RateLimiterService],
  exports: [RedisCache, RedisPubSub, RateLimiterService],
})
export class RedisModule {}
