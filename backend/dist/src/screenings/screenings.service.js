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
const halls_repository_1 = require("./halls.repository");
const screenings_repository_1 = require("./screenings.repository");
let ScreeningsService = class ScreeningsService {
    screeningsRepo;
    moviesRepo;
    hallsRepo;
    constructor(screeningsRepo, moviesRepo, hallsRepo) {
        this.screeningsRepo = screeningsRepo;
        this.moviesRepo = moviesRepo;
        this.hallsRepo = hallsRepo;
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
        return this.screeningsRepo.create({
            movieId: dto.movieId,
            hallId: dto.hallId,
            startTime: start,
            price: dto.price,
        });
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
        return this.screeningsRepo.update(id, data);
    }
    async cancelScreening(id) {
        const existing = await this.getExisting(id);
        if (existing.status === client_1.ScreenStatus.CANCELLED) {
            throw new common_1.BadRequestException('Screening is already cancelled');
        }
        return this.screeningsRepo.setStatus(id, client_1.ScreenStatus.CANCELLED);
    }
    async deleteScreening(id) {
        await this.getExisting(id);
        if (await this.screeningsRepo.hasReservations(id)) {
            throw new common_1.ConflictException('Cannot delete a screening with existing reservations; cancel it instead');
        }
        return this.screeningsRepo.delete(id);
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
        halls_repository_1.HallsRepository])
], ScreeningsService);
//# sourceMappingURL=screenings.service.js.map