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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreeningsController = void 0;
const common_1 = require("@nestjs/common");
const screenings_service_1 = require("./screenings.service");
let ScreeningsController = class ScreeningsController {
    screeningsService;
    constructor(screeningsService) {
        this.screeningsService = screeningsService;
    }
    movieScreenings(id) {
        return this.screeningsService.getMovieScreenings(id);
    }
    detail(id) {
        return this.screeningsService.getScreeningDetail(id);
    }
    seats(id) {
        return this.screeningsService.getSeatMap(id);
    }
};
exports.ScreeningsController = ScreeningsController;
__decorate([
    (0, common_1.Get)('movies/:id/screenings'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], ScreeningsController.prototype, "movieScreenings", null);
__decorate([
    (0, common_1.Get)('screenings/:id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], ScreeningsController.prototype, "detail", null);
__decorate([
    (0, common_1.Get)('screenings/:id/seats'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], ScreeningsController.prototype, "seats", null);
exports.ScreeningsController = ScreeningsController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [screenings_service_1.ScreeningsService])
], ScreeningsController);
//# sourceMappingURL=screenings.controller.js.map