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
var ScreeningsCache_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreeningsCache = void 0;
const common_1 = require("@nestjs/common");
const redis_cache_1 = __importDefault(require("../redis/redis.cache"));
const seatMapKey = (screeningId) => `seat_map:screening:${screeningId}`;
const SEAT_MAP_TTL_SECONDS = 300;
const screeningDetailKey = (id) => `screening:detail:${id}`;
const SCREENING_DETAIL_TTL_SECONDS = 60;
const movieScreeningsKey = (movieId) => `screening:future:${movieId}`;
const MOVIE_SCREENINGS_TTL_SECONDS = 60;
const HALL_LIST_KEY = 'hall:list';
const HALL_LIST_TTL_SECONDS = 300;
let ScreeningsCache = ScreeningsCache_1 = class ScreeningsCache {
    redis;
    logger = new common_1.Logger(ScreeningsCache_1.name);
    constructor(redis) {
        this.redis = redis;
    }
    async getSeatMap(screeningId) {
        try {
            const raw = await this.redis.get(seatMapKey(screeningId));
            return raw ? JSON.parse(raw) : null;
        }
        catch (err) {
            this.logger.warn(`getSeatMap(${screeningId}) cache miss on error: ${String(err)}`);
            return null;
        }
    }
    async setSeatMap(screeningId, seatMap) {
        try {
            await this.redis.set(seatMapKey(screeningId), JSON.stringify(seatMap), 'EX', SEAT_MAP_TTL_SECONDS);
        }
        catch (err) {
            this.logger.warn(`setSeatMap(${screeningId}) failed: ${String(err)}`);
        }
    }
    async delSeatMap(screeningId) {
        try {
            await this.redis.del(seatMapKey(screeningId));
        }
        catch (err) {
            this.logger.warn(`delSeatMap(${screeningId}) failed: ${String(err)}`);
        }
    }
    async getScreeningDetail(id) {
        try {
            const raw = await this.redis.get(screeningDetailKey(id));
            return raw ? JSON.parse(raw) : null;
        }
        catch (err) {
            this.logger.warn(`getScreeningDetail(${id}) cache miss on error: ${String(err)}`);
            return null;
        }
    }
    async setScreeningDetail(screening) {
        try {
            await this.redis.set(screeningDetailKey(screening.id), JSON.stringify(screening), 'EX', SCREENING_DETAIL_TTL_SECONDS);
        }
        catch (err) {
            this.logger.warn(`setScreeningDetail(${screening.id}) failed: ${String(err)}`);
        }
    }
    async delScreeningDetail(id) {
        try {
            await this.redis.del(screeningDetailKey(id));
        }
        catch (err) {
            this.logger.warn(`delScreeningDetail(${id}) failed: ${String(err)}`);
        }
    }
    async getMovieScreenings(movieId) {
        try {
            const raw = await this.redis.get(movieScreeningsKey(movieId));
            return raw ? JSON.parse(raw) : null;
        }
        catch (err) {
            this.logger.warn(`getMovieScreenings(${movieId}) cache miss on error: ${String(err)}`);
            return null;
        }
    }
    async setMovieScreenings(movieId, screenings) {
        try {
            await this.redis.set(movieScreeningsKey(movieId), JSON.stringify(screenings), 'EX', MOVIE_SCREENINGS_TTL_SECONDS);
        }
        catch (err) {
            this.logger.warn(`setMovieScreenings(${movieId}) failed: ${String(err)}`);
        }
    }
    async delMovieScreenings(movieId) {
        try {
            await this.redis.del(movieScreeningsKey(movieId));
        }
        catch (err) {
            this.logger.warn(`delMovieScreenings(${movieId}) failed: ${String(err)}`);
        }
    }
    async getHalls() {
        try {
            const raw = await this.redis.get(HALL_LIST_KEY);
            return raw ? JSON.parse(raw) : null;
        }
        catch (err) {
            this.logger.warn(`getHalls cache miss on error: ${String(err)}`);
            return null;
        }
    }
    async setHalls(halls) {
        try {
            await this.redis.set(HALL_LIST_KEY, JSON.stringify(halls), 'EX', HALL_LIST_TTL_SECONDS);
        }
        catch (err) {
            this.logger.warn(`setHalls failed: ${String(err)}`);
        }
    }
    async delHalls() {
        try {
            await this.redis.del(HALL_LIST_KEY);
        }
        catch (err) {
            this.logger.warn(`delHalls failed: ${String(err)}`);
        }
    }
};
exports.ScreeningsCache = ScreeningsCache;
exports.ScreeningsCache = ScreeningsCache = ScreeningsCache_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_cache_1.default])
], ScreeningsCache);
//# sourceMappingURL=screenings.cache.js.map