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
const RATE_LIMITER_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowSize = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local member = ARGV[4]

local windowStart = now - windowSize

redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

local count = redis.call('ZCARD', key)

if count < maxRequests then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowSize)
  local remaining = maxRequests - count - 1
  return {1, remaining, windowSize}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAfterMs = 0
  if #oldest >= 2 then
    resetAfterMs = (tonumber(oldest[2]) + windowSize) - now
    if resetAfterMs < 0 then resetAfterMs = 0 end
  end
  return {0, 0, resetAfterMs}
end
`;
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
        const member = (0, node_crypto_1.randomUUID)();
        const result = await client.eval(RATE_LIMITER_SCRIPT, 1, key, timestamp, config.windowSize, config.maxRequests, member);
        const [allowedFlag, remaining, resetAfterMs] = result;
        return {
            allowed: allowedFlag === 1,
            remaining,
            resetAfterMs,
        };
    }
};
RateLimiterService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_cache_1.default])
], RateLimiterService);
exports.default = RateLimiterService;
//# sourceMappingURL=rate-limiter.service.js.map