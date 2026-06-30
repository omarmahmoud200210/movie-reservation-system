"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreeningsModule = void 0;
const common_1 = require("@nestjs/common");
const movies_module_1 = require("../movies/movies.module");
const halls_admin_controller_1 = require("./halls-admin.controller");
const halls_service_1 = require("./halls.service");
const halls_repository_1 = require("./halls.repository");
const screenings_controller_1 = require("./screenings.controller");
const screenings_admin_controller_1 = require("./screenings-admin.controller");
const screenings_service_1 = require("./screenings.service");
const screenings_repository_1 = require("./screenings.repository");
const screenings_cache_1 = require("./screenings.cache");
let ScreeningsModule = class ScreeningsModule {
};
exports.ScreeningsModule = ScreeningsModule;
exports.ScreeningsModule = ScreeningsModule = __decorate([
    (0, common_1.Module)({
        imports: [movies_module_1.MoviesModule],
        controllers: [
            halls_admin_controller_1.HallsAdminController,
            screenings_admin_controller_1.ScreeningsAdminController,
            screenings_controller_1.ScreeningsController,
        ],
        providers: [
            halls_service_1.HallsService,
            halls_repository_1.HallsRepository,
            screenings_service_1.ScreeningsService,
            screenings_repository_1.ScreeningsRepository,
            screenings_cache_1.ScreeningsCache,
        ],
        exports: [halls_service_1.HallsService, halls_repository_1.HallsRepository, screenings_service_1.ScreeningsService, screenings_repository_1.ScreeningsRepository],
    })
], ScreeningsModule);
//# sourceMappingURL=screenings.module.js.map