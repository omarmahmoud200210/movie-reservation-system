import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CACHE, REDIS_PUBSUB } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_CACHE_HOST,
          port: Number(process.env.REDIS_CACHE_PORT),
        }),
    },
    {
      provide: REDIS_PUBSUB,
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_PUBSUB_HOST,
          port: Number(process.env.REDIS_PUBSUB_PORT),
        }),
    },
  ],
  exports: [REDIS_CACHE, REDIS_PUBSUB],
})
export class RedisModule {}
