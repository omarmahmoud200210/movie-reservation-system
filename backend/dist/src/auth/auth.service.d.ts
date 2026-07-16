import { User } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { OtpService } from './otp.service';
import { MailerService } from '../mailer/mailer.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { AuthUser } from './token.service';
import { AuditService } from '../common/services/audit.service';
export declare class AuthService {
    private readonly repo;
    private readonly otp;
    private readonly mailer;
    private readonly audit;
    constructor(repo: AuthRepository, otp: OtpService, mailer: MailerService, audit: AuditService);
    register(dto: RegisterDto): Promise<{
        message: string;
    }>;
    verifyOtp(dto: VerifyOtpDto): Promise<Omit<{
        name: string;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        email: string;
        password: string | null;
        emailVerified: boolean;
        googleId: string | null;
        role: import("@prisma/client").$Enums.UserRole;
    }, "password">>;
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
