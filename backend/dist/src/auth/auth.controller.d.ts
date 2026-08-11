import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import type { AuthUser } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { LoginDto } from './dto/login.dto';
import type { RefreshUser } from './strategies/jwt-refresh.strategy';
import type { GoogleProfile } from './util/google.profile.util';
import { AuditService } from '../common/services/audit.service';
export declare class AuthController {
    private readonly authService;
    private readonly tokenService;
    private readonly audit;
    constructor(authService: AuthService, tokenService: TokenService, audit: AuditService);
    register(dto: RegisterDto): Promise<{
        message: string;
    }>;
    verifyOtp(dto: VerifyOtpDto, res: Response): Promise<AuthUser>;
    resendOtp(dto: ResendOtpDto): Promise<{
        message: string;
    }>;
    login(_dto: LoginDto, user: AuthUser, res: Response): Promise<AuthUser>;
    refresh(user: RefreshUser, res: Response): Promise<{
        message: string;
    }>;
    logout(user: AuthUser, res: Response): Promise<{
        message: string;
    }>;
    me(user: AuthUser): AuthUser;
    googleAuth(): void;
    googleCallback(profile: GoogleProfile, res: Response): Promise<void>;
    linkGoogle(): void;
    linkGoogleCallback(profile: GoogleProfile, req: Request, res: Response): Promise<void>;
}
