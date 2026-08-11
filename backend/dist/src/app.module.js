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
const core_1 = require("@nestjs/core");
const ip_rate_limit_middleware_1 = require("./common/middleware/ip-rate-limit.middleware");
const metrics_interceptor_1 = require("./common/interceptors/metrics.interceptor");
const common_module_1 = require("./common/common.module");
const config_1 = require("@nestjs/config");
const event_emitter_1 = require("@nestjs/event-emitter");
const schedule_1 = require("@nestjs/schedule");
const prisma_module_1 = require("./prisma/prisma.module");
const redis_module_1 = require("./redis/redis.module");
const metrics_module_1 = require("./metrics/metrics.module");
const mailer_module_1 = require("./mailer/mailer.module");
const auth_module_1 = require("./auth/auth.module");
const movies_module_1 = require("./movies/movies.module");
const screenings_module_1 = require("./screenings/screenings.module");
const reservations_module_1 = require("./reservations/reservations.module");
const gateway_module_1 = require("./gateway/gateway.module");
const users_module_1 = require("./users/users.module");
const cron_module_1 = require("./cron/cron.module");
const payments_module_1 = require("./payments/payments.module");
let AppModule = class AppModule {
    configure(consumer) {
        consumer
            .apply(ip_rate_limit_middleware_1.IpRateLimitMiddleware)
            .forRoutes({ path: 'auth/login', method: common_1.RequestMethod.POST }, { path: 'movies', method: common_1.RequestMethod.GET }, { path: 'auth/register', method: common_1.RequestMethod.POST }, { path: 'auth/verify-otp', method: common_1.RequestMethod.POST }, { path: 'auth/resend-otp', method: common_1.RequestMethod.POST }, { path: 'auth/refresh', method: common_1.RequestMethod.POST });
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
            common_module_1.CommonModule,
            prisma_module_1.PrismaModule,
            redis_module_1.RedisModule,
            metrics_module_1.MetricsModule,
            mailer_module_1.MailerModule,
            auth_module_1.AuthModule,
            movies_module_1.MoviesModule,
            screenings_module_1.ScreeningsModule,
            reservations_module_1.ReservationsModule,
            users_module_1.UsersModule,
            gateway_module_1.GatewayModule,
            cron_module_1.CronModule,
            payments_module_1.PaymentsModule,
        ],
        providers: [{ provide: core_1.APP_INTERCEPTOR, useClass: metrics_interceptor_1.MetricsInterceptor }],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map