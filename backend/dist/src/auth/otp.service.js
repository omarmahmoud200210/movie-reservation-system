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
exports.OtpService = void 0;
const common_1 = require("@nestjs/common");
const redis_cache_1 = __importDefault(require("../redis/redis.cache"));
const crypto_1 = require("crypto");
const auth_env_config_1 = require("./auth-env.config");
let OtpService = class OtpService {
    redis;
    constructor(redis) {
        this.redis = redis;
    }
    gen() {
        return (0, crypto_1.randomInt)(100000, 999999).toString();
    }
    async issue(email) {
        const cooldownKey = `otp_cooldown:${email}`;
        if (await this.redis.get(cooldownKey)) {
            throw new common_1.BadRequestException('Please wait before requesting another code');
        }
        const code = this.gen();
        const ttl = auth_env_config_1.authEnv.otpTtlSeconds;
        await this.redis
            .pipeline()
            .set(`otp:${email}`, code, 'EX', ttl)
            .del(`otp_attempts:${email}`)
            .set(cooldownKey, '1', 'EX', auth_env_config_1.authEnv.otpResendCooldownSeconds)
            .exec();
        return code;
    }
    async verify(email, code) {
        const key = `otp:${email}`;
        const stored = await this.redis.get(key);
        if (!stored)
            throw new common_1.BadRequestException('Code expired or not found');
        const pipeline = this.redis.pipeline();
        pipeline.incr(`otp_attempts:${email}`);
        pipeline.expire(`otp_attempts:${email}`, auth_env_config_1.authEnv.otpTtlSeconds);
        const result = (await pipeline.exec());
        const attempts = result[0][1];
        if (attempts > auth_env_config_1.authEnv.otpMaxAttempts) {
            await this.redis.del(key);
            throw new common_1.BadRequestException('Too many attempts, request a new code');
        }
        if (stored !== code)
            return false;
        await this.redis.del(key);
        await this.redis.del(`otp_attempts:${email}`);
        return true;
    }
};
exports.OtpService = OtpService;
exports.OtpService = OtpService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_cache_1.default])
], OtpService);
//# sourceMappingURL=otp.service.js.map