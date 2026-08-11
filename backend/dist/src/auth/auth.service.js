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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const auth_repository_1 = require("./auth.repository");
const otp_service_1 = require("./otp.service");
const mailer_service_1 = require("../mailer/mailer.service");
const audit_service_1 = require("../common/services/audit.service");
const argon2_1 = __importDefault(require("argon2"));
const client_1 = require("@prisma/client");
let AuthService = class AuthService {
    repo;
    otp;
    mailer;
    audit;
    constructor(repo, otp, mailer, audit) {
        this.repo = repo;
        this.otp = otp;
        this.mailer = mailer;
        this.audit = audit;
    }
    async register(dto) {
        try {
            const existing = await this.repo.findByEmail(dto.email);
            if (existing) {
                return { message: 'If eligible, a verification code was sent' };
            }
            const hash = await argon2_1.default.hash(dto.password);
            const user = await this.repo.createUser({
                name: dto.name,
                email: dto.email,
                password: hash,
            });
            const code = await this.otp.issue(user.email);
            await this.mailer.sendOtpEmail(user.email, code);
            await this.audit.record({
                action: 'user.registered',
                targetType: 'user',
                targetId: user.id,
            });
            return { message: 'If eligible, a verification code was sent' };
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                return { message: 'If eligible, a verification code was sent' };
            }
            throw err;
        }
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
        const matches = await argon2_1.default.verify(user.password, password);
        if (!matches) {
            await this.audit.record({
                action: 'login.failed',
                actorId: user.id,
                metadata: { reason: 'wrong_password' },
            });
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        if (!user.emailVerified) {
            throw new common_1.ForbiddenException('Email not verified');
        }
        return { id: user.id, email: user.email, role: user.role, name: user.name };
    }
    async getAuthUser(id) {
        const user = await this.repo.findById(id);
        if (!user)
            throw new common_1.UnauthorizedException('User no longer exists');
        return { id: user.id, email: user.email, role: user.role, name: user.name };
    }
    async resolveGoogleUser(p) {
        const byGoogle = await this.repo.findByGoogleId(p.googleId);
        if (byGoogle) {
            await this.audit.record({
                action: 'login.google.success',
                actorId: byGoogle.id,
            });
            return {
                id: byGoogle.id,
                email: byGoogle.email,
                role: byGoogle.role,
                name: byGoogle.name,
            };
        }
        const byEmail = await this.repo.findByEmail(p.email);
        if (byEmail) {
            throw new common_1.ConflictException('An account with this email already exists. Log in with your password and link Google in settings.');
        }
        const user = await this.repo.createGoogleUser(p);
        await this.audit.record({
            action: 'user.google.created',
            targetType: 'user',
            targetId: user.id,
        });
        return { id: user.id, email: user.email, role: user.role, name: user.name };
    }
    async linkGoogle(userId, googleId) {
        const owner = await this.repo.findByGoogleId(googleId);
        if (owner) {
            if (owner.id === userId)
                return owner;
            throw new common_1.ConflictException('This Google account is already linked to another user');
        }
        const updated = await this.repo.setGoogleId(userId, googleId);
        await this.audit.record({
            action: 'user.google.linked',
            actorId: userId,
            targetType: 'user',
            targetId: userId,
        });
        return updated;
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
        mailer_service_1.MailerService,
        audit_service_1.AuditService])
], AuthService);
//# sourceMappingURL=auth.service.js.map