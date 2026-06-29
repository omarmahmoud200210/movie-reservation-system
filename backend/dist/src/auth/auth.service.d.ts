import { User } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { OtpService } from './otp.service';
import { MailerService } from '../mailer/mailer.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { AuthUser } from './token.service';
export declare class AuthService {
    private readonly repo;
    private readonly otp;
    private readonly mailer;
    constructor(repo: AuthRepository, otp: OtpService, mailer: MailerService);
    register(dto: RegisterDto): Promise<{
        message: string;
    }>;
    verifyOtp(dto: VerifyOtpDto): Promise<{
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
    validateUser(email: string, password: string): Promise<User>;
    getAuthUser(id: number): Promise<AuthUser>;
    resolveGoogleUser(p: {
        email: string;
        name: string;
        googleId: string;
    }): Promise<User>;
    linkGoogle(userId: number, googleId: string): Promise<User>;
    resendOtp(dto: ResendOtpDto): Promise<{
        message: string;
    }>;
}
