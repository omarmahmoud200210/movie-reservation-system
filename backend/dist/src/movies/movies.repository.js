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
exports.MoviesRepository = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let MoviesRepository = class MoviesRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(data) {
        return this.prisma.write.movie.create({ data });
    }
    update(id, data) {
        return this.prisma.write.movie.update({ where: { id }, data });
    }
    findById(id) {
        return this.prisma.read.movie.findUnique({ where: { id } });
    }
    setStatus(id, status) {
        return this.prisma.write.movie.update({ where: { id }, data: { status } });
    }
    delete(id) {
        return this.prisma.write.movie.delete({ where: { id } });
    }
    listAll() {
        return this.prisma.read.movie.findMany({ orderBy: { createdAt: 'desc' } });
    }
    findPublishedById(id) {
        return this.prisma.read.movie.findFirst({
            where: { id, status: client_1.MovieStatus.PUBLISHED },
        });
    }
    findPublishedForBrowse(now) {
        return this.prisma.read.movie.findMany({
            where: { status: client_1.MovieStatus.PUBLISHED },
            include: {
                screens: {
                    where: { status: client_1.ScreenStatus.SCHEDULED, startTime: { gt: now } },
                    select: { id: true },
                    take: 1,
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async hasReservations(movieId) {
        const reservations = await this.prisma.read.reservation.findFirst({
            where: { screen: { movieId } },
            select: { id: true },
        });
        return reservations !== null;
    }
};
exports.MoviesRepository = MoviesRepository;
exports.MoviesRepository = MoviesRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MoviesRepository);
//# sourceMappingURL=movies.repository.js.map