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
exports.ScreeningsRepository = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let ScreeningsRepository = class ScreeningsRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(data) {
        return this.prisma.write.screening.create({ data });
    }
    update(id, data) {
        return this.prisma.write.screening.update({ where: { id }, data });
    }
    findById(id) {
        return this.prisma.read.screening.findUnique({
            where: { id },
            include: { movie: true, hall: true },
        });
    }
    setStatus(id, status) {
        return this.prisma.write.screening.update({ where: { id }, data: { status } });
    }
    delete(id) {
        return this.prisma.write.screening.delete({ where: { id } });
    }
    async hasReservations(screeningId) {
        const reservation = await this.prisma.read.reservation.findFirst({
            where: { screeningId },
            select: { id: true },
        });
        return reservation !== null;
    }
    async findOverlapping(hallId, start, end, excludeId) {
        const candidates = await this.prisma.read.screening.findMany({
            where: {
                hallId,
                status: { not: client_1.ScreenStatus.CANCELLED },
                ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
            },
            include: { movie: { select: { duration: true } } },
        });
        const startMs = start.getTime();
        const endMs = end.getTime();
        return candidates.filter((s) => {
            const sStart = s.startTime.getTime();
            const sEnd = sStart + s.movie.duration * 60_000;
            return sStart < endMs && sEnd > startMs;
        });
    }
    findFutureScheduledByMovie(movieId, now) {
        return this.prisma.read.screening.findMany({
            where: {
                movieId,
                status: client_1.ScreenStatus.SCHEDULED,
                startTime: { gt: now },
            },
            select: {
                id: true,
                startTime: true,
                price: true,
                hall: { select: { id: true, name: true, capacity: true } },
            },
            orderBy: { startTime: 'asc' },
        });
    }
    findSeatsByHall(hallId) {
        return this.prisma.read.seat.findMany({
            where: { hallId },
            orderBy: [{ row: 'asc' }, { id: 'asc' }],
        });
    }
    findActiveReservations(screeningId) {
        return this.prisma.read.reservation.findMany({
            where: {
                screeningId,
                status: {
                    in: [client_1.ReservationStatus.HELD, client_1.ReservationStatus.CONFIRMED],
                },
            },
            select: { seatId: true, status: true },
        });
    }
};
exports.ScreeningsRepository = ScreeningsRepository;
exports.ScreeningsRepository = ScreeningsRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ScreeningsRepository);
//# sourceMappingURL=screenings.repository.js.map