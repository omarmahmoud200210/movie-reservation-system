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
const screenings_cache_1 = require("./screenings.cache");
let HallsService = class HallsService {
    hallsRepo;
    screeningsCache;
    constructor(hallsRepo, screeningsCache) {
        this.hallsRepo = hallsRepo;
        this.screeningsCache = screeningsCache;
    }
    async createHall(dto) {
        const hall = await this.hallsRepo.createHallWithSeats(dto);
        await this.screeningsCache.delHalls();
        return hall;
    }
    async getHall(id) {
        const hall = await this.hallsRepo.findHallWithSeats(id);
        if (!hall) {
            throw new common_1.NotFoundException(`Hall ${id} not found`);
        }
        return hall;
    }
    async listHalls() {
        const cached = await this.screeningsCache.getHalls();
        if (cached) {
            return cached;
        }
        const halls = await this.hallsRepo.listHalls();
        await this.screeningsCache.setHalls(halls);
        return halls;
    }
    async deleteHall(id) {
        const hall = await this.hallsRepo.findHallWithSeats(id);
        if (!hall) {
            throw new common_1.NotFoundException(`Hall ${id} not found`);
        }
        if (await this.hallsRepo.hasReservations(id)) {
            throw new common_1.ConflictException('Cannot delete a hall with existing reservations');
        }
        const deleted = await this.hallsRepo.deleteHall(id);
        await this.screeningsCache.delHalls();
        return deleted;
    }
};
exports.HallsService = HallsService;
exports.HallsService = HallsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [halls_repository_1.HallsRepository,
        screenings_cache_1.ScreeningsCache])
], HallsService);
//# sourceMappingURL=halls.service.js.map