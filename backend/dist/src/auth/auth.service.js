"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcrypt"));
const auth_repository_1 = require("./auth.repository");
const otp_service_1 = require("./otp.service");
const mailer_service_1 = require("../mailer/mailer.service");
let AuthService = class AuthService {
    repo;
    otp;
    mailer;
    constructor(repo, otp, mailer) {
        this.repo = repo;
        this.otp = otp;
        this.mailer = mailer;
    }
    async register(dto) {
        const existing = await this.repo.findByEmail(dto.email);
        if (existing)
            throw new common_1.ConflictException('Email already registered');
        const hash = await bcrypt.hash(dto.password, 10);
        const user = await this.repo.createUser({
            name: dto.name,
            email: dto.email,
            password: hash,
        });
        const code = await this.otp.issue(user.email);
        await this.mailer.sendOtpEmail(user.email, code);
        return { message: 'Verification code sent' };
    }
    async verifyOtp(dto) {
        const user = await this.repo.findByEmail(dto.email);
        if (!user)
            throw new common_1.BadRequestException('Invalid email');
        if (user.emailVerified)
            throw new common_1.BadRequestException('Already verified');
        const ok = await this.otp.verify(dto.email, dto.code);
        if (!ok)
            throw new common_1.BadRequestException('Invalid code');
        return this.repo.markEmailVerified(user.id);
    }
    async validateUser(email, password) {
        const user = await this.repo.findByEmail(email);
        if (!user || !user.password) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        const matches = await bcrypt.compare(password, user.password);
        if (!matches) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        if (!user.emailVerified) {
            throw new common_1.ForbiddenException('Email not verified');
        }
        return user;
    }
    async getAuthUser(id) {
        const user = await this.repo.findById(id);
        if (!user)
            throw new common_1.UnauthorizedException('User no longer exists');
        return { id: user.id, email: user.email, role: user.role, name: user.name };
    }
    async resolveGoogleUser(p) {
        const byGoogle = await this.repo.findByGoogleId(p.googleId);
        if (byGoogle)
            return byGoogle;
        const byEmail = await this.repo.findByEmail(p.email);
        if (byEmail) {
            throw new common_1.ConflictException('An account with this email already exists. Log in with your password and link Google in settings.');
        }
        return this.repo.createGoogleUser(p);
    }
    async linkGoogle(userId, googleId) {
        const owner = await this.repo.findByGoogleId(googleId);
        if (owner) {
            if (owner.id === userId)
                return owner;
            throw new common_1.ConflictException('This Google account is already linked to another user');
        }
        return this.repo.setGoogleId(userId, googleId);
    }
    async resendOtp(dto) {
        const user = await this.repo.findByEmail(dto.email);
        if (!user || user.emailVerified) {
            return { message: 'If eligible, a code was sent' };
        }
        const code = await this.otp.issue(user.email);
        await this.mailer.sendOtpEmail(user.email, code);
        return { message: 'Verification code sent' };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [auth_repository_1.AuthRepository,
        otp_service_1.OtpService,
        mailer_service_1.MailerService])
], AuthService);
//# sourceMappingURL=auth.service.js.map