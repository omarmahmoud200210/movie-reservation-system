import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import RedisCache from '../redis/redis.cache';
import { authEnv } from './auth-env.config';
import type { UserRole } from '@prisma/client';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

interface AccessPayload {
  sub: number;
  name: string;
  email: string;
  role: string;
  ver: number;
}

interface RefreshPayload {
  sub: number;
  jti: string;
}

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // 15m
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

const ROTATE_SCRIPT = `
local exists = redis.call('GET', KEYS[1])
if not exists then
  return {0}
end
redis.call('DEL', KEYS[1])
redis.call('SET', ARGV[1], '1', 'EX', ARGV[2])
redis.call('SREM', KEYS[2], ARGV[3])
redis.call('SADD', KEYS[2], ARGV[4])
return {1}
`;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisCache,
  ) {}

  private async signAccess(user: AuthUser): Promise<string> {
    const ver = await this.getAccessVersion(user.id);
    return this.jwt.sign(
      {
        sub: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        ver,
      },
      {
        secret: authEnv.jwtAccessSecret,
        expiresIn: authEnv.jwtAccessExpiresIn,
      } as JwtSignOptions,
    );
  }

  private signRefresh(user: { id: number }): { token: string; jti: string } {
    const jti = randomUUID();
    const token = this.jwt.sign({ sub: user.id, jti }, {
      secret: authEnv.jwtRefreshSecret,
      expiresIn: authEnv.jwtRefreshExpiresIn,
    } as JwtSignOptions);
    return { token, jti };
  }

  private refreshKey(userId: number, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  private sessionSetKey(userId: number): string {
    return `refresh_sessions:${userId}`;
  }

  /** Sign a fresh access+refresh pair, persist the refresh jti, and set cookies. */
  async issueAuthCookies(res: Response, user: AuthUser): Promise<void> {
    const access = await this.signAccess(user);
    const { token: refresh, jti } = this.signRefresh(user);
    const client = this.redis.getClient();
    await client
      .multi()
      .set(this.refreshKey(user.id, jti), '1', 'EX', REFRESH_TTL_SECONDS)
      .sadd(this.sessionSetKey(user.id), jti)
      .exec();
    this.setAuthCookies(res, access, refresh);
  }

  /**
   * Atomically rotate a refresh token: validate old jti, delete it, persist
   * the new one — all in a single Lua eval. Throws 401 if the old jti is
   * unknown/revoked (theft detection: if a concurrent request already consumed
   * it, the legitimate user is the loser and must re-auth).
   */
  async rotateAuthCookies(
    res: Response,
    payload: { id: number; jti: string },
    user: AuthUser,
  ): Promise<void> {
    const oldKey = this.refreshKey(payload.id, payload.jti);
    const { token: newRefresh, jti: newJti } = this.signRefresh(user);
    const newKey = this.refreshKey(user.id, newJti);
    const setKey = this.sessionSetKey(user.id);

    const result = (await this.redis
      .getClient()
      .eval(
        ROTATE_SCRIPT,
        2,
        oldKey,
        setKey,
        newKey,
        String(REFRESH_TTL_SECONDS),
        payload.jti,
        newJti,
      )) as [number];

    if (result[0] === 0) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const access = await this.signAccess(user);
    this.setAuthCookies(res, access, newRefresh);
  }

  private accessVersionKey(userId: number): string {
    return `access_version:${userId}`;
  }

  async incrementAccessVersion(userId: number): Promise<void> {
    const key = this.accessVersionKey(userId);
    await this.redis
      .getClient()
      .multi()
      .incr(key)
      .expire(key, REFRESH_TTL_SECONDS)
      .exec();
  }

  async getAccessVersion(userId: number): Promise<number> {
    const val = await this.redis.get(this.accessVersionKey(userId));
    return val ? Number(val) : 0;
  }

  /**
   * Sign a short-lived state token bound to the user initiating a Google link.
   * Passed as the OAuth `state` param and echoed back by Google, it lets the
   * callback trust the initiator's id (CSRF defense) instead of an ambient
   * cookie. See verifyLinkState.
   */
  signLinkState(userId: number): string {
    return this.jwt.sign({ sub: userId }, {
      secret: authEnv.linkStateSecret,
      expiresIn: '10m',
    } as JwtSignOptions);
  }

  /** Verify a link-state token and return the bound user id. 401 if missing/invalid. */
  verifyLinkState(token: string | undefined): { id: number } {
    if (!token) {
      throw new UnauthorizedException('Missing link state');
    }
    try {
      const payload = this.jwt.verify<{ sub: number }>(token, {
        secret: authEnv.linkStateSecret,
      });
      return { id: payload.sub };
    } catch {
      throw new UnauthorizedException('Invalid or expired link state');
    }
  }

  setAuthCookies(res: Response, access: string, refresh: string): void {
    const base = {
      httpOnly: true,
      secure: authEnv.nodeEnv === 'production',
      sameSite: 'strict' as const,
      domain: authEnv.cookieDomain,
    };
    res.cookie('access_token', access, { ...base, maxAge: ACCESS_MAX_AGE_MS });
    res.cookie('refresh_token', refresh, {
      ...base,
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }

  clearAuthCookies(res: Response): void {
    const base = {
      httpOnly: true,
      secure: authEnv.nodeEnv === 'production',
      sameSite: 'strict' as const,
      domain: authEnv.cookieDomain,
    };
    res.clearCookie('access_token', base);
    res.clearCookie('refresh_token', { ...base, path: REFRESH_COOKIE_PATH });
  }

  /**
   * Revokes every refresh session for a user (e.g. on password change).
   * Uses a per-user SET to look up active JTIs in O(M) instead of scanning
   * the entire keyspace with KEYS.
   */
  async revokeAllSessions(userId: number): Promise<void> {
    const client = this.redis.getClient();
    const setKey = this.sessionSetKey(userId);
    const jtis = await client.smembers(setKey);

    if (jtis.length > 0) {
      const refreshKeys = jtis.map((jti) => this.refreshKey(userId, jti));
      await client.del(...refreshKeys, setKey);
    }
  }
}

export type { AccessPayload, RefreshPayload };
