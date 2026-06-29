import RedisCache from './redis.cache';
export interface RateLimiterConfig {
    windowSize: number;
    maxRequests: number;
}
export interface RateLimiterResult {
    allowed: boolean;
    remaining: number;
    resetAfterMs: number;
}
export default class RateLimiterService {
    private readonly redis;
    constructor(redis: RedisCache);
    private getClient;
    rateLimiter(key: string, config: RateLimiterConfig): Promise<RateLimiterResult>;
}
