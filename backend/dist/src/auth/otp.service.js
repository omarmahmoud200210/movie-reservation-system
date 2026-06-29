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
let OtpService = class OtpService {
    redis;
    constructor(redis) {
        this.redis = redis;
    }
    gen() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
    async issue(email) {
        const cooldownKey = `otp_cooldown:${email}`;
        if (await this.redis.get(cooldownKey)) {
            throw new common_1.BadRequestException('Please wait before requesting another code');
        }
        const code = this.gen();
        const ttl = Number(process.env.OTP_TTL_SECONDS);
        await this.redis
            .pipeline()
            .set(`otp:${email}`, code, 'EX', ttl)
            .del(`otp_attempts:${email}`)
            .set(cooldownKey, '1', 'EX', Number(process.env.OTP_RESEND_COOLDOWN_SECONDS))
            .exec();
        return code;
    }
    async verify(email, code) {
        const key = `otp:${email}`;
        const stored = await this.redis.get(key);
        if (!stored)
            throw new common_1.BadRequestException('Code expired or not found');
        const attempts = await this.redis.incr(`otp_attempts:${email}`);
        if (attempts > Number(process.env.OTP_MAX_ATTEMPTS)) {
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