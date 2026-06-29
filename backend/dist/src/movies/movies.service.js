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
exports.MoviesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const movies_repository_1 = require("./movies.repository");
let MoviesService = class MoviesService {
    moviesRepo;
    constructor(moviesRepo) {
        this.moviesRepo = moviesRepo;
    }
    createMovie(dto) {
        return this.moviesRepo.create(dto);
    }
    async updateMovie(id, dto) {
        await this.getExisting(id);
        return this.moviesRepo.update(id, dto);
    }
    async publish(id) {
        const movie = await this.getExisting(id);
        if (movie.status === client_1.MovieStatus.PUBLISHED) {
            throw new common_1.BadRequestException('Movie is already published');
        }
        return this.moviesRepo.setStatus(id, client_1.MovieStatus.PUBLISHED);
    }
    async unpublish(id) {
        const movie = await this.getExisting(id);
        if (movie.status === client_1.MovieStatus.DRAFT) {
            throw new common_1.BadRequestException('Movie is already a draft');
        }
        return this.moviesRepo.setStatus(id, client_1.MovieStatus.DRAFT);
    }
    async deleteMovie(id) {
        await this.getExisting(id);
        if (await this.moviesRepo.hasReservations(id)) {
            throw new common_1.ConflictException('Cannot delete a movie with existing reservations; unpublish it instead');
        }
        return this.moviesRepo.delete(id);
    }
    listAllForAdmin() {
        return this.moviesRepo.listAll();
    }
    async getExisting(id) {
        const movie = await this.moviesRepo.findById(id);
        if (!movie) {
            throw new common_1.NotFoundException(`Movie ${id} not found`);
        }
        return movie;
    }
};
exports.MoviesService = MoviesService;
exports.MoviesService = MoviesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [movies_repository_1.MoviesRepository])
], MoviesService);
//# sourceMappingURL=movies.service.js.map