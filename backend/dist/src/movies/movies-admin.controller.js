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
exports.MoviesAdminController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const create_movie_dto_1 = require("./dto/create-movie.dto");
const update_movie_dto_1 = require("./dto/update-movie.dto");
const movies_service_1 = require("./movies.service");
let MoviesAdminController = class MoviesAdminController {
    moviesService;
    constructor(moviesService) {
        this.moviesService = moviesService;
    }
    create(dto) {
        return this.moviesService.createMovie(dto);
    }
    update(id, dto) {
        return this.moviesService.updateMovie(id, dto);
    }
    publish(id) {
        return this.moviesService.publish(id);
    }
    unpublish(id) {
        return this.moviesService.unpublish(id);
    }
    remove(id) {
        return this.moviesService.deleteMovie(id);
    }
    listAll() {
        return this.moviesService.listAllForAdmin();
    }
};
exports.MoviesAdminController = MoviesAdminController;
__decorate([
    (0, common_1.Post)('movies'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_movie_dto_1.CreateMovieDto]),
    __metadata("design:returntype", void 0)
], MoviesAdminController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)('movies/:id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, update_movie_dto_1.UpdateMovieDto]),
    __metadata("design:returntype", void 0)
], MoviesAdminController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)('movies/:id/publish'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MoviesAdminController.prototype, "publish", null);
__decorate([
    (0, common_1.Patch)('movies/:id/unpublish'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MoviesAdminController.prototype, "unpublish", null);
__decorate([
    (0, common_1.Delete)('movies/:id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MoviesAdminController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('admin/movies'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MoviesAdminController.prototype, "listAll", null);
exports.MoviesAdminController = MoviesAdminController = __decorate([
    (0, common_1.Controller)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __metadata("design:paramtypes", [movies_service_1.MoviesService])
], MoviesAdminController);
//# sourceMappingURL=movies-admin.controller.js.map