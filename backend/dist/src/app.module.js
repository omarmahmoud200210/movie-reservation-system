"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const ip_rate_limit_middleware_1 = require("./common/middleware/ip-rate-limit.middleware");
const config_1 = require("@nestjs/config");
const event_emitter_1 = require("@nestjs/event-emitter");
const schedule_1 = require("@nestjs/schedule");
const prisma_module_1 = require("./prisma/prisma.module");
const redis_module_1 = require("./redis/redis.module");
const mailer_module_1 = require("./mailer/mailer.module");
const auth_module_1 = require("./auth/auth.module");
const movies_module_1 = require("./movies/movies.module");
const screenings_module_1 = require("./screenings/screenings.module");
const reservations_module_1 = require("./reservations/reservations.module");
const gateway_module_1 = require("./gateway/gateway.module");
const users_module_1 = require("./users/users.module");
const cron_module_1 = require("./cron/cron.module");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(ip_rate_limit_middleware_1.IpRateLimitMiddleware).forRoutes({ path: 'auth/login', method: common_1.RequestMethod.POST }, { path: 'movies', method: common_1.RequestMethod.GET });
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            event_emitter_1.EventEmitterModule.forRoot(),
            schedule_1.ScheduleModule.forRoot(),
            prisma_module_1.PrismaModule,
            redis_module_1.RedisModule,
            mailer_module_1.MailerModule,
            auth_module_1.AuthModule,
            movies_module_1.MoviesModule,
            screenings_module_1.ScreeningsModule,
            reservations_module_1.ReservationsModule,
            users_module_1.UsersModule,
            gateway_module_1.GatewayModule,
            cron_module_1.CronModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map