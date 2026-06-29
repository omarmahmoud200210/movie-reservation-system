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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const auth_service_1 = require("./auth.service");
const token_service_1 = require("./token.service");
const register_dto_1 = require("./dto/register.dto");
const verify_otp_dto_1 = require("./dto/verify-otp.dto");
const resend_otp_dto_1 = require("./dto/resend-otp.dto");
const login_dto_1 = require("./dto/login.dto");
const local_auth_guard_1 = require("./guards/local-auth.guard");
const jwt_auth_guard_1 = require("./guards/jwt-auth.guard");
const jwt_refresh_guard_1 = require("./guards/jwt-refresh.guard");
const google_auth_guard_1 = require("./guards/google-auth.guard");
const google_link_auth_guard_1 = require("./guards/google-link-auth.guard");
const current_user_decorator_1 = require("./decorators/current-user.decorator");
let AuthController = class AuthController {
    authService;
    tokenService;
    constructor(authService, tokenService) {
        this.authService = authService;
        this.tokenService = tokenService;
    }
    register(dto) {
        return this.authService.register(dto);
    }
    async verifyOtp(dto, res) {
        const user = await this.authService.verifyOtp(dto);
        await this.tokenService.issueAuthCookies(res, {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
        });
        return user;
    }
    resendOtp(dto) {
        return this.authService.resendOtp(dto);
    }
    async login(_dto, user, res) {
        await this.tokenService.issueAuthCookies(res, user);
        return user;
    }
    async refresh(user, res) {
        const fresh = await this.authService.getAuthUser(user.id);
        await this.tokenService.rotateAuthCookies(res, { id: user.id, jti: user.jti }, fresh);
        return { message: 'Token refreshed' };
    }
    logout(res) {
        this.tokenService.clearAuthCookies(res);
        return { message: 'Logged out' };
    }
    me(user) {
        return user;
    }
    googleAuth() {
    }
    async googleCallback(profile, res) {
        try {
            const user = await this.authService.resolveGoogleUser(profile);
            await this.tokenService.issueAuthCookies(res, {
                id: user.id,
                email: user.email,
                role: user.role,
                name: user.name,
            });
            return res.redirect(`${process.env.FRONTEND_URL}/auth/google/callback`);
        }
        catch (err) {
            if (err instanceof common_1.ConflictException) {
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=account_exists`);
            }
            throw err;
        }
    }
    linkGoogle() {
    }
    async linkGoogleCallback(profile, req, res) {
        const query = req.query;
        const { id } = this.tokenService.verifyLinkState(query.state);
        try {
            await this.authService.linkGoogle(id, profile.googleId);
            return res.redirect(`${process.env.FRONTEND_URL}/settings?linked=google`);
        }
        catch (err) {
            if (err instanceof common_1.ConflictException) {
                return res.redirect(`${process.env.FRONTEND_URL}/settings?error=google_already_linked`);
            }
            throw err;
        }
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('verify-otp'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [verify_otp_dto_1.VerifyOtpDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyOtp", null);
__decorate([
    (0, common_1.Post)('resend-otp'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [resend_otp_dto_1.ResendOtpDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "resendOtp", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseGuards)(local_auth_guard_1.LocalAuthGuard),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseGuards)(jwt_refresh_guard_1.JwtRefreshGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "me", null);
__decorate([
    (0, common_1.Get)('google'),
    (0, common_1.UseGuards)(google_auth_guard_1.GoogleAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "googleAuth", null);
__decorate([
    (0, common_1.Get)('google/callback'),
    (0, common_1.UseGuards)(google_auth_guard_1.GoogleAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "googleCallback", null);
__decorate([
    (0, common_1.Get)('link-google'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, google_link_auth_guard_1.GoogleLinkAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "linkGoogle", null);
__decorate([
    (0, common_1.Get)('link-google/callback'),
    (0, common_1.UseGuards)(google_link_auth_guard_1.GoogleLinkAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "linkGoogleCallback", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        token_service_1.TokenService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map