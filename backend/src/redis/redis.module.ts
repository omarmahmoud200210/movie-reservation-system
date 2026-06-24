import { Global, Module } from '@nestjs/common';
import RedisCache from './redis.cache';
import RedisPubSub from './redis.pubsub';
@Global()
@Module({
  providers: [RedisCache, RedisPubSub],
  exports: [RedisCache, RedisPubSub],
})
export class RedisModule {}
