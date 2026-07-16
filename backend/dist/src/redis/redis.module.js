"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisModule = void 0;
const common_1 = require("@nestjs/common");
const redis_cache_1 = __importDefault(require("./redis.cache"));
const rate_limiter_service_1 = __importDefault(require("./rate-limiter.service"));
const payment_abuse_service_1 = __importDefault(require("./payment-abuse.service"));
let RedisModule = class RedisModule {
};
exports.RedisModule = RedisModule;
exports.RedisModule = RedisModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [redis_cache_1.default, rate_limiter_service_1.default, payment_abuse_service_1.default],
        exports: [redis_cache_1.default, rate_limiter_service_1.default, payment_abuse_service_1.default],
    })
], RedisModule);
//# sourceMappingURL=redis.module.js.map