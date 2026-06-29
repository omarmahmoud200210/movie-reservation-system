import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import type { AuthUser } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { LoginDto } from './dto/login.dto';
import type { RefreshUser } from './strategies/jwt-refresh.strategy';
import type { GoogleProfile } from './strategies/google.strategy';
export declare class AuthController {
    private readonly authService;
    private readonly tokenService;
    constructor(authService: AuthService, tokenService: TokenService);
    register(dto: RegisterDto): Promise<{
        message: string;
    }>;
    verifyOtp(dto: VerifyOtpDto, res: Response): Promise<{
        name: string;
        id: number;
        email: string;
        password: string | null;
        emailVerified: boolean;
        googleId: string | null;
        role: import("@prisma/client").$Enums.UserRole;
        createdAt: Date;
        updatedAt: Date;
    }>;
    resendOtp(dto: ResendOtpDto): Promise<{
        message: string;
    }>;
    login(_dto: LoginDto, user: AuthUser, res: Response): Promise<AuthUser>;
    refresh(user: RefreshUser, res: Response): Promise<{
        message: string;
    }>;
    logout(res: Response): {
        message: string;
    };
    me(user: AuthUser): AuthUser;
    googleAuth(): void;
    googleCallback(profile: GoogleProfile, res: Response): Promise<void>;
    linkGoogle(): void;
    linkGoogleCallback(profile: GoogleProfile, req: Request, res: Response): Promise<void>;
}
