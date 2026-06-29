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
exports.HallsRepository = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let HallsRepository = class HallsRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    rowLabel(index) {
        let n = index;
        let label = '';
        do {
            label = String.fromCharCode(65 + (n % 26)) + label;
            n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        return label;
    }
    createHallWithSeats(input) {
        const { name, rows, seatsPerRow } = input;
        const capacity = rows * seatsPerRow;
        return this.prisma.$transaction(async (tx) => {
            const hall = await tx.hall.create({ data: { name, capacity } });
            const seats = [];
            for (let r = 0; r < rows; r++) {
                const row = this.rowLabel(r);
                for (let s = 1; s <= seatsPerRow; s++) {
                    seats.push({ hallId: hall.id, row, number: String(s) });
                }
            }
            await tx.seat.createMany({ data: seats });
            return tx.hall.findUniqueOrThrow({
                where: { id: hall.id },
                include: { seats: { orderBy: [{ row: 'asc' }, { id: 'asc' }] } },
            });
        });
    }
    findHallWithSeats(id) {
        return this.prisma.hall.findUnique({
            where: { id },
            include: { seats: { orderBy: [{ row: 'asc' }, { id: 'asc' }] } },
        });
    }
    listHalls() {
        return this.prisma.hall.findMany({ orderBy: { id: 'asc' } });
    }
    findById(id) {
        return this.prisma.hall.findUnique({ where: { id } });
    }
    deleteHall(id) {
        return this.prisma.hall.delete({ where: { id } });
    }
    async hasReservations(hallId) {
        const reservation = await this.prisma.reservation.findFirst({
            where: { screen: { hallId } },
            select: { id: true },
        });
        return reservation !== null;
    }
};
exports.HallsRepository = HallsRepository;
exports.HallsRepository = HallsRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], HallsRepository);
//# sourceMappingURL=halls.repository.js.map