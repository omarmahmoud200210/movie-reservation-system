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
exports.HallsService = void 0;
const common_1 = require("@nestjs/common");
const halls_repository_1 = require("./halls.repository");
let HallsService = class HallsService {
    hallsRepo;
    constructor(hallsRepo) {
        this.hallsRepo = hallsRepo;
    }
    createHall(dto) {
        return this.hallsRepo.createHallWithSeats(dto);
    }
    async getHall(id) {
        const hall = await this.hallsRepo.findHallWithSeats(id);
        if (!hall) {
            throw new common_1.NotFoundException(`Hall ${id} not found`);
        }
        return hall;
    }
    listHalls() {
        return this.hallsRepo.listHalls();
    }
    async deleteHall(id) {
        const hall = await this.hallsRepo.findHallWithSeats(id);
        if (!hall) {
            throw new common_1.NotFoundException(`Hall ${id} not found`);
        }
        if (await this.hallsRepo.hasReservations(id)) {
            throw new common_1.ConflictException('Cannot delete a hall with existing reservations');
        }
        return this.hallsRepo.deleteHall(id);
    }
};
exports.HallsService = HallsService;
exports.HallsService = HallsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [halls_repository_1.HallsRepository])
], HallsService);
//# sourceMappingURL=halls.service.js.map