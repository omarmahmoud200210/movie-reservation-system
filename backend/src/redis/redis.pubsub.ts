import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export default class RedisPubSub implements OnModuleDestroy, OnModuleInit {
  private redis: Redis;
  private readonly logger = new Logger(RedisPubSub.name);

  constructor() {}

  onModuleInit() {
    this.redis = new Redis({
      host: process.env.REDIS_PUBSUB_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PUBSUB_PORT ?? 6380),
    });

    this.redis.on('connect', () => this.logger.log('Redis Pub/Sub connected'));
    this.redis.on('error', (err) =>
      this.logger.error('Redis Pub/Sub error', err),
    );
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  getClient(): Redis {
    return this.redis;
  }
}
