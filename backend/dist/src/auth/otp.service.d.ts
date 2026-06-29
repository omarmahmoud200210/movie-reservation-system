import RedisCache from '../redis/redis.cache';
export declare class OtpService {
    private readonly redis;
    constructor(redis: RedisCache);
    private gen;
    issue(email: string): Promise<string>;
    verify(email: string, code: string): Promise<boolean>;
}
