import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { OtpService } from './otp.service';
import { MailerService } from '../mailer/mailer.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { AuthUser } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly otp: OtpService,
    private readonly mailer: MailerService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

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

  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.repo.findByEmail(dto.email);
    if (!user) throw new BadRequestException('Invalid email');
    if (user.emailVerified) throw new BadRequestException('Already verified');

    const ok = await this.otp.verify(dto.email, dto.code);
    if (!ok) throw new BadRequestException('Invalid code');

    // Phase 1: verified-only. Auto-login cookies are wired when Phase 2's
    // TokenService lands.
    return this.repo.markEmailVerified(user.id);
  }

  /**
   * Used by LocalStrategy. Verifies credentials and that the account is
   * email-verified. Wrong/missing credentials → 401; unverified account → 403.
   */
  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.repo.findByEmail(email);
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.emailVerified) {
      throw new ForbiddenException('Email not verified');
    }
    return user;
  }

  async getAuthUser(id: number): Promise<AuthUser> {
    const user = await this.repo.findById(id);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }

  /**
   * Core Google sign-in branch. Existing Google users log in; brand-new emails
   * become verified Google accounts; emails already owned by a manual (password)
   * account are blocked and must link Google from settings.
   */
  async resolveGoogleUser(p: {
    email: string;
    name: string;
    googleId: string;
  }): Promise<User> {
    const byGoogle = await this.repo.findByGoogleId(p.googleId);
    if (byGoogle) return byGoogle; // existing google user → login

    const byEmail = await this.repo.findByEmail(p.email);
    if (byEmail) {
      // manual account exists → BLOCK
      throw new ConflictException(
        'An account with this email already exists. Log in with your password and link Google in settings.',
      );
    }
    return this.repo.createGoogleUser(p); // brand new → create verified
  }

  /**
   * Attach a verified Google account to an existing (password) user. Idempotent
   * if the googleId is already this user's; blocks if another account owns it.
   */
  async linkGoogle(userId: number, googleId: string): Promise<User> {
    const owner = await this.repo.findByGoogleId(googleId);
    if (owner) {
      if (owner.id === userId) return owner; // already linked to this user
      throw new ConflictException(
        'This Google account is already linked to another user',
      );
    }
    return this.repo.setGoogleId(userId, googleId);
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.repo.findByEmail(dto.email);
    if (!user || user.emailVerified) {
      return { message: 'If eligible, a code was sent' };
    }
    const code = await this.otp.issue(user.email);
    await this.mailer.sendOtpEmail(user.email, code);
    return { message: 'Verification code sent' };
  }
}
