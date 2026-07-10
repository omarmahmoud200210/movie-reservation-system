import { Global, Module } from '@nestjs/common';
import RedisCache from './redis.cache';
import RedisPubSub from './redis.pubsub';
import RateLimiterService from './rate-limiter.service';
import PaymentAbuseService from './payment-abuse.service';
@Global()
@Module({
  providers: [RedisCache, RedisPubSub, RateLimiterService, PaymentAbuseService],
  exports: [RedisCache, RedisPubSub, RateLimiterService, PaymentAbuseService],
})
export class RedisModule {}
