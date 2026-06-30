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
var MoviesCache_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoviesCache = void 0;
const common_1 = require("@nestjs/common");
const redis_cache_1 = __importDefault(require("../redis/redis.cache"));
const movieKey = (id) => `movie:${id}`;
const NOW_SHOWING_KEY = 'movies:now_showing';
const COMING_SOON_KEY = 'movies:coming_soon';
const MOVIE_TTL_SECONDS = 3600;
const LIST_TTL_SECONDS = 60;
let MoviesCache = MoviesCache_1 = class MoviesCache {
    redis;
    logger = new common_1.Logger(MoviesCache_1.name);
    constructor(redis) {
        this.redis = redis;
    }
    async getMovie(id) {
        try {
            const raw = await this.redis.get(movieKey(id));
            return raw ? JSON.parse(raw) : null;
        }
        catch (err) {
            this.logger.warn(`getMovie(${id}) cache miss on error: ${String(err)}`);
            return null;
        }
    }
    async setMovie(movie) {
        try {
            await this.redis.set(movieKey(movie.id), JSON.stringify(movie), 'EX', MOVIE_TTL_SECONDS);
        }
        catch (err) {
            this.logger.warn(`setMovie(${movie.id}) failed: ${String(err)}`);
        }
    }
    async delMovie(id) {
        try {
            await this.redis.del(movieKey(id));
        }
        catch (err) {
            this.logger.warn(`delMovie(${id}) failed: ${String(err)}`);
        }
    }
    async getLists() {
        try {
            const [nowRaw, soonRaw] = await Promise.all([
                this.redis.get(NOW_SHOWING_KEY),
                this.redis.get(COMING_SOON_KEY),
            ]);
            if (nowRaw === null || soonRaw === null) {
                return null;
            }
            return {
                nowShowing: JSON.parse(nowRaw),
                comingSoon: JSON.parse(soonRaw),
            };
        }
        catch (err) {
            this.logger.warn(`getLists cache miss on error: ${String(err)}`);
            return null;
        }
    }
    async setLists(lists) {
        try {
            await Promise.all([
                this.redis.set(NOW_SHOWING_KEY, JSON.stringify(lists.nowShowing), 'EX', LIST_TTL_SECONDS),
                this.redis.set(COMING_SOON_KEY, JSON.stringify(lists.comingSoon), 'EX', LIST_TTL_SECONDS),
            ]);
        }
        catch (err) {
            this.logger.warn(`setLists failed: ${String(err)}`);
        }
    }
    async delLists() {
        try {
            await this.redis.del(NOW_SHOWING_KEY, COMING_SOON_KEY);
        }
        catch (err) {
            this.logger.warn(`delLists failed: ${String(err)}`);
        }
    }
};
exports.MoviesCache = MoviesCache;
exports.MoviesCache = MoviesCache = MoviesCache_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_cache_1.default])
], MoviesCache);
//# sourceMappingURL=movies.cache.js.map