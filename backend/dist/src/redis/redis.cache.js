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
var RedisCache_1;
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
let RedisCache = RedisCache_1 = class RedisCache {
    redis;
    logger = new common_1.Logger(RedisCache_1.name);
    constructor() { }
    onModuleInit() {
        this.redis = new ioredis_1.default({
            host: process.env.REDIS_CACHE_HOST ?? 'localhost',
            port: Number(process.env.REDIS_CACHE_PORT ?? 6379),
            password: process.env.REDIS_CACHE_PASSWORD,
            tls: process.env.REDIS_CACHE_TLS === 'true' ? {} : undefined,
        });
        this.redis.on('connect', () => this.logger.log('Redis Caching connected'));
        this.redis.on('error', (err) => this.logger.error('Redis Caching error', err));
    }
    onModuleDestroy() {
        this.redis.disconnect();
    }
    getClient() {
        return this.redis;
    }
    get(key) {
        return this.redis.get(key);
    }
    set(key, value, ...args) {
        return this.redis.set(key, value, ...args);
    }
    del(...keys) {
        return this.redis.del(...keys);
    }
    incr(key) {
        return this.redis.incr(key);
    }
    pipeline() {
        return this.redis.pipeline();
    }
};
RedisCache = RedisCache_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], RedisCache);
exports.default = RedisCache;
//# sourceMappingURL=redis.cache.js.map