import { BadRequestException, Injectable } from '@nestjs/common';
import RedisCache from '../redis/redis.cache';

@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisCache) {}

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
    // These three writes are independent, so batch them into one round-trip.
    await this.redis
      .pipeline()
      .set(`otp:${email}`, code, 'EX', ttl)
      .del(`otp_attempts:${email}`)
      .set(
        cooldownKey,
        '1',
        'EX',
        Number(process.env.OTP_RESEND_COOLDOWN_SECONDS),
      )
      .exec();
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
