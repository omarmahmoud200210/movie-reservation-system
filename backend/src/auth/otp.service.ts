import { BadRequestException, Injectable } from '@nestjs/common';
import RedisCache from '../redis/redis.cache';
import { randomInt } from 'crypto';
import { authEnv } from './auth-env.config';

@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisCache) {}

  private gen(): string {
    return randomInt(100000, 999999).toString();
  }

  async issue(email: string): Promise<string> {
    const cooldownKey = `otp_cooldown:${email}`;
    if (await this.redis.get(cooldownKey)) {
      throw new BadRequestException(
        'Please wait before requesting another code',
      );
    }
    const code = this.gen();
    const ttl = authEnv.otpTtlSeconds;
    // These three writes are independent, so batch them into one round-trip.
    await this.redis
      .pipeline()
      .set(`otp:${email}`, code, 'EX', ttl)
      .del(`otp_attempts:${email}`)
      .set(cooldownKey, '1', 'EX', authEnv.otpResendCooldownSeconds)
      .exec();
    return code;
  }

  async verify(email: string, code: string): Promise<boolean> {
    const key = `otp:${email}`;
    const stored = await this.redis.get(key);
    if (!stored) throw new BadRequestException('Code expired or not found');

    const pipeline = this.redis.pipeline();
    pipeline.incr(`otp_attempts:${email}`);
    pipeline.expire(`otp_attempts:${email}`, authEnv.otpTtlSeconds);

    const result = (await pipeline.exec()) as [Error | null, number][];
    const attempts = result[0][1];

    if (attempts > authEnv.otpMaxAttempts) {
      await this.redis.del(key);
      throw new BadRequestException('Too many attempts, request a new code');
    }

    if (stored !== code) return false;

    await this.redis.del(key);
    await this.redis.del(`otp_attempts:${email}`);
    return true;
  }
}
