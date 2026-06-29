import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
export default class RedisPubSub implements OnModuleDestroy, OnModuleInit {
    private redis;
    private readonly logger;
    constructor();
    onModuleInit(): void;
    onModuleDestroy(): void;
    getClient(): Redis;
}
