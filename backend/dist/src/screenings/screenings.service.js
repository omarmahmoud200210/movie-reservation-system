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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreeningsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const movies_repository_1 = require("../movies/movies.repository");
const movies_cache_1 = require("../movies/movies.cache");
const halls_repository_1 = require("./halls.repository");
const screenings_repository_1 = require("./screenings.repository");
const screenings_cache_1 = require("./screenings.cache");
let ScreeningsService = class ScreeningsService {
    screeningsRepo;
    moviesRepo;
    hallsRepo;
    screeningsCache;
    moviesCache;
    constructor(screeningsRepo, moviesRepo, hallsRepo, screeningsCache, moviesCache) {
        this.screeningsRepo = screeningsRepo;
        this.moviesRepo = moviesRepo;
        this.hallsRepo = hallsRepo;
        this.screeningsCache = screeningsCache;
        this.moviesCache = moviesCache;
    }
    async createScreening(dto) {
        const movie = await this.moviesRepo.findById(dto.movieId);
        if (!movie) {
            throw new common_1.NotFoundException(`Movie ${dto.movieId} not found`);
        }
        const hall = await this.hallsRepo.findById(dto.hallId);
        if (!hall) {
            throw new common_1.NotFoundException(`Hall ${dto.hallId} not found`);
        }
        const start = new Date(dto.startTime);
        const end = this.computeEnd(start, movie.duration);
        await this.assertNoOverlap(dto.hallId, start, end);
        const screening = await this.screeningsRepo.create({
            movieId: dto.movieId,
            hallId: dto.hallId,
            startTime: start,
            price: dto.price,
        });
        await this.moviesCache.delLists();
        return screening;
    }
    async updateScreening(id, dto) {
        const existing = await this.getExisting(id);
        const hallId = dto.hallId ?? existing.hallId;
        const start = dto.startTime ? new Date(dto.startTime) : existing.startTime;
        let duration = existing.movie.duration;
        if (dto.movieId !== undefined && dto.movieId !== existing.movieId) {
            const movie = await this.moviesRepo.findById(dto.movieId);
            if (!movie) {
                throw new common_1.NotFoundException(`Movie ${dto.movieId} not found`);
            }
            duration = movie.duration;
        }
        if (dto.hallId !== undefined && dto.hallId !== existing.hallId) {
            const hall = await this.hallsRepo.findById(dto.hallId);
            if (!hall) {
                throw new common_1.NotFoundException(`Hall ${dto.hallId} not found`);
            }
        }
        const end = this.computeEnd(start, duration);
        await this.assertNoOverlap(hallId, start, end, id);
        const data = {};
        if (dto.movieId !== undefined)
            data.movieId = dto.movieId;
        if (dto.hallId !== undefined)
            data.hallId = dto.hallId;
        if (dto.startTime !== undefined)
            data.startTime = start;
        if (dto.price !== undefined)
            data.price = dto.price;
        const updated = await this.screeningsRepo.update(id, data);
        await this.moviesCache.delLists();
        await this.screeningsCache.delSeatMap(id);
        return updated;
    }
    async cancelScreening(id) {
        const existing = await this.getExisting(id);
        if (existing.status === client_1.ScreenStatus.CANCELLED) {
            throw new common_1.BadRequestException('Screening is already cancelled');
        }
        const cancelled = await this.screeningsRepo.setStatus(id, client_1.ScreenStatus.CANCELLED);
        await this.moviesCache.delLists();
        await this.screeningsCache.delSeatMap(id);
        return cancelled;
    }
    async deleteScreening(id) {
        await this.getExisting(id);
        if (await this.screeningsRepo.hasReservations(id)) {
            throw new common_1.ConflictException('Cannot delete a screening with existing reservations; cancel it instead');
        }
        const deleted = await this.screeningsRepo.delete(id);
        await this.moviesCache.delLists();
        await this.screeningsCache.delSeatMap(id);
        return deleted;
    }
    async getScreeningDetail(id) {
        const screening = await this.screeningsRepo.findById(id);
        if (!screening || screening.status === client_1.ScreenStatus.CANCELLED) {
            throw new common_1.NotFoundException(`Screening ${id} not found`);
        }
        return screening;
    }
    async getMovieScreenings(movieId) {
        const movie = await this.moviesRepo.findPublishedById(movieId);
        if (!movie) {
            throw new common_1.NotFoundException(`Movie ${movieId} not found`);
        }
        return this.screeningsRepo.findFutureScheduledByMovie(movieId, new Date());
    }
    async getSeatMap(screeningId) {
        const cached = await this.screeningsCache.getSeatMap(screeningId);
        if (cached) {
            return cached;
        }
        const screening = await this.screeningsRepo.findById(screeningId);
        if (!screening || screening.status === client_1.ScreenStatus.CANCELLED) {
            throw new common_1.NotFoundException(`Screening ${screeningId} not found`);
        }
        const [seats, reservations] = await Promise.all([
            this.screeningsRepo.findSeatsByHall(screening.hallId),
            this.screeningsRepo.findActiveReservations(screeningId),
        ]);
        const statusBySeat = new Map();
        for (const r of reservations) {
            statusBySeat.set(r.seatId, r.status);
        }
        const seatMap = seats.map((seat) => ({
            seatId: seat.id,
            row: seat.row,
            number: seat.number,
            status: this.toSeatStatus(statusBySeat.get(seat.id)),
        }));
        await this.screeningsCache.setSeatMap(screeningId, seatMap);
        return seatMap;
    }
    async getScreeningSummary(screeningId) {
        const seatMap = await this.getSeatMap(screeningId);
        let held = 0;
        let booked = 0;
        for (const seat of seatMap) {
            if (seat.status === client_1.SeatStatus.HELD)
                held++;
            else if (seat.status === client_1.SeatStatus.BOOKED)
                booked++;
        }
        const capacity = seatMap.length;
        return {
            screeningId,
            capacity,
            held,
            booked,
            available: capacity - held - booked,
            reserved: held + booked,
        };
    }
    toSeatStatus(reservationStatus) {
        if (reservationStatus === client_1.ReservationStatus.HELD)
            return client_1.SeatStatus.HELD;
        if (reservationStatus === client_1.ReservationStatus.CONFIRMED) {
            return client_1.SeatStatus.BOOKED;
        }
        return client_1.SeatStatus.AVAILABLE;
    }
    async assertNoOverlap(hallId, start, end, excludeId) {
        const overlapping = await this.screeningsRepo.findOverlapping(hallId, start, end, excludeId);
        if (overlapping.length > 0) {
            throw new common_1.ConflictException('Hall already has a screening scheduled in this time range');
        }
    }
    computeEnd(start, durationMinutes) {
        return new Date(start.getTime() + durationMinutes * 60_000);
    }
    async getExisting(id) {
        const screening = await this.screeningsRepo.findById(id);
        if (!screening) {
            throw new common_1.NotFoundException(`Screening ${id} not found`);
        }
        return screening;
    }
};
exports.ScreeningsService = ScreeningsService;
exports.ScreeningsService = ScreeningsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [screenings_repository_1.ScreeningsRepository,
        movies_repository_1.MoviesRepository,
        halls_repository_1.HallsRepository,
        screenings_cache_1.ScreeningsCache,
        movies_cache_1.MoviesCache])
], ScreeningsService);
//# sourceMappingURL=screenings.service.js.map