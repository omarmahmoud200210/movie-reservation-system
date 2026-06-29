"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const redis_cache_1 = __importDefault(require("./redis.cache"));
const node_crypto_1 = require("node:crypto");
let RateLimiterService = class RateLimiterService {
    redis;
    constructor(redis) {
        this.redis = redis;
    }
    getClient() {
        return this.redis.getClient();
    }
    async rateLimiter(key, config) {
        const client = this.getClient();
        const timestamp = Date.now();
        const windowStart = timestamp - config.windowSize;
        const multi = await client
            .multi()
            .zremrangebyscore(key, 0, windowStart)
            .zcard(key)
            .zadd(key, timestamp, (0, node_crypto_1.randomUUID)())
            .pexpire(key, config.windowSize)
            .exec();
        if (!Array.isArray(multi)) {
            throw new Error('Failed to execute Redis pipeline');
        }
        const count = Number(multi[1][1]);
        const allowed = count < config.maxRequests;
        const remaining = Math.max(0, config.maxRequests - count - 1);
        if (!allowed) {
            return {
                allowed: false,
                remaining: 0,
                resetAfterMs: config.windowSize,
            };
        }
        return {
            allowed: true,
            remaining: remaining,
            resetAfterMs: config.windowSize,
        };
    }
};
RateLimiterService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_cache_1.default])
], RateLimiterService);
exports.default = RateLimiterService;
//# sourceMappingURL=rate-limiter.service.js.map