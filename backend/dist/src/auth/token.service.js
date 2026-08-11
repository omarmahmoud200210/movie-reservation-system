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
const auth_env_config_1 = require("./auth-env.config");
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
redis.call('SREM', KEYS[2], ARGV[3])
redis.call('SADD', KEYS[2], ARGV[4])
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
        return this.jwt.sign({
            sub: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            ver,
        }, {
            secret: auth_env_config_1.authEnv.jwtAccessSecret,
            expiresIn: auth_env_config_1.authEnv.jwtAccessExpiresIn,
        });
    }
    signRefresh(user) {
        const jti = (0, crypto_1.randomUUID)();
        const token = this.jwt.sign({ sub: user.id, jti }, {
            secret: auth_env_config_1.authEnv.jwtRefreshSecret,
            expiresIn: auth_env_config_1.authEnv.jwtRefreshExpiresIn,
        });
        return { token, jti };
    }
    refreshKey(userId, jti) {
        return `refresh:${userId}:${jti}`;
    }
    sessionSetKey(userId) {
        return `refresh_sessions:${userId}`;
    }
    async issueAuthCookies(res, user) {
        const access = await this.signAccess(user);
        const { token: refresh, jti } = this.signRefresh(user);
        const client = this.redis.getClient();
        await client
            .multi()
            .set(this.refreshKey(user.id, jti), '1', 'EX', REFRESH_TTL_SECONDS)
            .sadd(this.sessionSetKey(user.id), jti)
            .exec();
        this.setAuthCookies(res, access, refresh);
    }
    async rotateAuthCookies(res, payload, user) {
        const oldKey = this.refreshKey(payload.id, payload.jti);
        const { token: newRefresh, jti: newJti } = this.signRefresh(user);
        const newKey = this.refreshKey(user.id, newJti);
        const setKey = this.sessionSetKey(user.id);
        const result = (await this.redis
            .getClient()
            .eval(ROTATE_SCRIPT, 2, oldKey, setKey, newKey, String(REFRESH_TTL_SECONDS), payload.jti, newJti));
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
        const key = this.accessVersionKey(userId);
        await this.redis
            .getClient()
            .multi()
            .incr(key)
            .expire(key, REFRESH_TTL_SECONDS)
            .exec();
    }
    async getAccessVersion(userId) {
        const val = await this.redis.get(this.accessVersionKey(userId));
        return val ? Number(val) : 0;
    }
    signLinkState(userId) {
        return this.jwt.sign({ sub: userId }, {
            secret: auth_env_config_1.authEnv.linkStateSecret,
            expiresIn: '10m',
        });
    }
    verifyLinkState(token) {
        if (!token) {
            throw new common_1.UnauthorizedException('Missing link state');
        }
        try {
            const payload = this.jwt.verify(token, {
                secret: auth_env_config_1.authEnv.linkStateSecret,
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
            secure: auth_env_config_1.authEnv.nodeEnv === 'production',
            sameSite: 'strict',
            domain: auth_env_config_1.authEnv.cookieDomain,
        };
        res.cookie('access_token', access, { ...base, maxAge: ACCESS_MAX_AGE_MS });
        res.cookie('refresh_token', refresh, {
            ...base,
            path: REFRESH_COOKIE_PATH,
            maxAge: REFRESH_MAX_AGE_MS,
        });
    }
    clearAuthCookies(res) {
        const base = {
            httpOnly: true,
            secure: auth_env_config_1.authEnv.nodeEnv === 'production',
            sameSite: 'strict',
            domain: auth_env_config_1.authEnv.cookieDomain,
        };
        res.clearCookie('access_token', base);
        res.clearCookie('refresh_token', { ...base, path: REFRESH_COOKIE_PATH });
    }
    async revokeAllSessions(userId) {
        const client = this.redis.getClient();
        const setKey = this.sessionSetKey(userId);
        const jtis = await client.smembers(setKey);
        if (jtis.length > 0) {
            const refreshKeys = jtis.map((jti) => this.refreshKey(userId, jti));
            await client.del(...refreshKeys, setKey);
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