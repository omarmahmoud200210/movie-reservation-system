import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
export default class RedisCache implements OnModuleDestroy, OnModuleInit {
    private redis;
    private readonly logger;
    constructor();
    onModuleInit(): void;
    onModuleDestroy(): void;
    getClient(): Redis;
    get(key: string): Promise<string | null>;
    set(key: string, value: string | number, ...args: unknown[]): Promise<'OK' | null>;
    del(...keys: string[]): Promise<number>;
    incr(key: string): Promise<number>;
    pipeline(): ReturnType<Redis['pipeline']>;
}
