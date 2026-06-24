import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthRepository } from './auth.repository';
import { OtpService } from './otp.service';
import { MailerService } from '../mailer/mailer.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';

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
