"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const auth_repository_1 = require("./auth.repository");
const otp_service_1 = require("./otp.service");
const token_service_1 = require("./token.service");
const local_strategy_1 = require("./strategies/local.strategy");
const jwt_strategy_1 = require("./strategies/jwt.strategy");
const jwt_refresh_strategy_1 = require("./strategies/jwt-refresh.strategy");
const google_strategy_1 = require("./strategies/google.strategy");
const google_link_strategy_1 = require("./strategies/google-link.strategy");
const mailer_module_1 = require("../mailer/mailer.module");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [mailer_module_1.MailerModule, passport_1.PassportModule, jwt_1.JwtModule.register({})],
        controllers: [auth_controller_1.AuthController],
        providers: [
            auth_service_1.AuthService,
            auth_repository_1.AuthRepository,
            otp_service_1.OtpService,
            token_service_1.TokenService,
            local_strategy_1.LocalStrategy,
            jwt_strategy_1.JwtStrategy,
            jwt_refresh_strategy_1.JwtRefreshStrategy,
            google_strategy_1.GoogleStrategy,
            google_link_strategy_1.GoogleLinkStrategy,
        ],
        exports: [auth_service_1.AuthService, otp_service_1.OtpService, token_service_1.TokenService],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map