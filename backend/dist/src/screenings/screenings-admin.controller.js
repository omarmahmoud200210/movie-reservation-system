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
exports.ScreeningsAdminController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const audit_service_1 = require("../common/services/audit.service");
const create_screening_dto_1 = require("./dto/create-screening.dto");
const update_screening_dto_1 = require("./dto/update-screening.dto");
const screenings_service_1 = require("./screenings.service");
let ScreeningsAdminController = class ScreeningsAdminController {
    screeningsService;
    audit;
    constructor(screeningsService, audit) {
        this.screeningsService = screeningsService;
        this.audit = audit;
    }
    async create(dto, user) {
        const screening = await this.screeningsService.createScreening(dto);
        await this.audit.record({
            action: 'screening.created',
            actorId: user.id,
            targetType: 'screening',
            targetId: screening.id,
        });
        return screening;
    }
    async update(id, dto, user) {
        const screening = await this.screeningsService.updateScreening(id, dto);
        await this.audit.record({
            action: 'screening.updated',
            actorId: user.id,
            targetType: 'screening',
            targetId: id,
        });
        return screening;
    }
    async cancel(id, user) {
        const screening = await this.screeningsService.cancelScreening(id);
        await this.audit.record({
            action: 'screening.cancelled',
            actorId: user.id,
            targetType: 'screening',
            targetId: id,
        });
        return screening;
    }
    async remove(id, user) {
        const result = await this.screeningsService.deleteScreening(id);
        await this.audit.record({
            action: 'screening.deleted',
            actorId: user.id,
            targetType: 'screening',
            targetId: id,
        });
        return result;
    }
};
exports.ScreeningsAdminController = ScreeningsAdminController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_screening_dto_1.CreateScreeningDto, Object]),
    __metadata("design:returntype", Promise)
], ScreeningsAdminController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, update_screening_dto_1.UpdateScreeningDto, Object]),
    __metadata("design:returntype", Promise)
], ScreeningsAdminController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], ScreeningsAdminController.prototype, "cancel", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], ScreeningsAdminController.prototype, "remove", null);
exports.ScreeningsAdminController = ScreeningsAdminController = __decorate([
    (0, common_1.Controller)('screenings'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __metadata("design:paramtypes", [screenings_service_1.ScreeningsService,
        audit_service_1.AuditService])
], ScreeningsAdminController);
//# sourceMappingURL=screenings-admin.controller.js.map