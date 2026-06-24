import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CACHE } from '../redis/redis.constants';

@Injectable()
export class OtpService {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  private gen(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async issue(email: string): Promise<string> {
    const cooldownKey = `otp_cooldown:${email}`;
    if (await this.redis.get(cooldownKey)) {
      throw new BadRequestException(
        'Please wait before requesting another code',
      );
    }
    const code = this.gen();
    const ttl = Number(process.env.OTP_TTL_SECONDS);
    await this.redis.set(`otp:${email}`, code, 'EX', ttl);
    await this.redis.del(`otp_attempts:${email}`);
    await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      Number(process.env.OTP_RESEND_COOLDOWN_SECONDS),
    );
    return code;
  }

  async verify(email: string, code: string): Promise<boolean> {
    const key = `otp:${email}`;
    const stored = await this.redis.get(key);
    if (!stored) throw new BadRequestException('Code expired or not found');

    const attempts = await this.redis.incr(`otp_attempts:${email}`);
    if (attempts > Number(process.env.OTP_MAX_ATTEMPTS)) {
      await this.redis.del(key);
      throw new BadRequestException('Too many attempts, request a new code');
    }
    if (stored !== code) return false;

    await this.redis.del(key);
    await this.redis.del(`otp_attempts:${email}`);
    return true;
  }
}
