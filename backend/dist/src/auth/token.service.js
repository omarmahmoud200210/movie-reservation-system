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
exports.TokenService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const crypto_1 = require("crypto");
const redis_cache_1 = __importDefault(require("../redis/redis.cache"));
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
const ROTATE_SCRIPT = `
local exists = redis.call('GET', KEYS[1])
if not exists then
  return {0}
end
redis.call('DEL', KEYS[1])
redis.call('SET', ARGV[1], '1', 'EX', ARGV[2])
return {1}
`;
let TokenService = class TokenService {
    jwt;
    redis;
    constructor(jwt, redis) {
        this.jwt = jwt;
        this.redis = redis;
    }
    async signAccess(user) {
        const ver = await this.getAccessVersion(user.id);
        return this.jwt.sign({ sub: user.id, name: user.name, email: user.email, role: user.role, ver }, {
            secret: process.env.JWT_ACCESS_SECRET,
            expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
        });
    }
    signRefresh(user) {
        const jti = (0, crypto_1.randomUUID)();
        const token = this.jwt.sign({ sub: user.id, jti }, {
            secret: process.env.JWT_REFRESH_SECRET,
            expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
        });
        return { token, jti };
    }
    refreshKey(userId, jti) {
        return `refresh:${userId}:${jti}`;
    }
    async issueAuthCookies(res, user) {
        const access = await this.signAccess(user);
        const { token: refresh, jti } = this.signRefresh(user);
        await this.redis.set(this.refreshKey(user.id, jti), '1', 'EX', REFRESH_TTL_SECONDS);
        this.setAuthCookies(res, access, refresh);
    }
    async rotateAuthCookies(res, payload, user) {
        const oldKey = this.refreshKey(payload.id, payload.jti);
        const { token: newRefresh, jti: newJti } = this.signRefresh(user);
        const newKey = this.refreshKey(user.id, newJti);
        const result = await this.redis.getClient().eval(ROTATE_SCRIPT, 1, oldKey, newKey, String(REFRESH_TTL_SECONDS));
        if (result[0] === 0) {
            throw new common_1.UnauthorizedException('Refresh token revoked or expired');
        }
        const access = await this.signAccess(user);
        this.setAuthCookies(res, access, newRefresh);
    }
    accessVersionKey(userId) {
        return `access_version:${userId}`;
    }
    async incrementAccessVersion(userId) {
        await this.redis.incr(this.accessVersionKey(userId));
    }
    async getAccessVersion(userId) {
        const val = await this.redis.get(this.accessVersionKey(userId));
        return val ? Number(val) : 0;
    }
    signLinkState(userId) {
        return this.jwt.sign({ sub: userId }, {
            secret: process.env.LINK_STATE_SECRET,
            expiresIn: '10m',
        });
    }
    verifyLinkState(token) {
        if (!token) {
            throw new common_1.UnauthorizedException('Missing link state');
        }
        try {
            const payload = this.jwt.verify(token, {
                secret: process.env.LINK_STATE_SECRET,
            });
            return { id: payload.sub };
        }
        catch {
            throw new common_1.UnauthorizedException('Invalid or expired link state');
        }
    }
    setAuthCookies(res, access, refresh) {
        const base = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            domain: process.env.COOKIE_DOMAIN,
        };
        res.cookie('access_token', access, { ...base, maxAge: ACCESS_MAX_AGE_MS });
        res.cookie('refresh_token', refresh, {
            ...base,
            path: REFRESH_COOKIE_PATH,
            maxAge: REFRESH_MAX_AGE_MS,
        });
    }
    clearAuthCookies(res) {
        res.clearCookie('access_token');
        res.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
    }
    async revokeAllSessions(userId) {
        const client = this.redis.getClient();
        const keys = await client.keys(`refresh:${userId}:*`);
        if (keys.length > 0) {
            await client.del(...keys);
        }
    }
};
exports.TokenService = TokenService;
exports.TokenService = TokenService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        redis_cache_1.default])
], TokenService);
//# sourceMappingURL=token.service.js.map