import { Global, Module } from '@nestjs/common';
import RedisCache from './redis.cache';
import RateLimiterService from './rate-limiter.service';
import PaymentAbuseService from './payment-abuse.service';
@Global()
@Module({
  providers: [RedisCache, RateLimiterService, PaymentAbuseService],
  exports: [RedisCache, RateLimiterService, PaymentAbuseService],
})
export class RedisModule {}
