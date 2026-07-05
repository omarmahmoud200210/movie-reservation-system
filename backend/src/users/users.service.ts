import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import { UsersRepository } from './users.repository';
import RedisCache from '../redis/redis.cache';
import { OtpService } from '../auth/otp.service';
import { MailerService } from '../mailer/mailer.service';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import type { AuthUser } from '../auth/token.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly redis: RedisCache,
    private readonly otp: OtpService,
    private readonly mailer: MailerService,
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  async updateName(userId: number, name: string): Promise<AuthUser> {
    await this.usersRepo.updateName(userId, name);
    return this.authService.getAuthUser(userId);
  }

  async requestEmailChange(
    userId: number,
    newEmail: string,
    currentPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.usersRepo.findById(userId);
    if (!user?.password) throw new UnauthorizedException('Invalid credentials');
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) throw new UnauthorizedException('Invalid credentials');

    const existing = await this.usersRepo.findByEmail(newEmail);
    if (existing) throw new ConflictException('Email already registered');

    await this.redis.set(
      `pending_email:${userId}`,
      newEmail,
      'EX',
      Number(process.env.OTP_TTL_SECONDS),
    );
    const code = await this.otp.issue(newEmail);
    await this.mailer.sendOtpEmail(newEmail, code);
    return { message: 'Verification code sent to new email' };
  }
}
