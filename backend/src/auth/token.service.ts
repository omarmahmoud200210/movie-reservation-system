import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import RedisCache from '../redis/redis.cache';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface AccessPayload {
  sub: number;
  name: string;
  email: string;
  role: string;
}

interface RefreshPayload {
  sub: number;
  jti: string;
}

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // 15m
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisCache,
  ) {}

  private signAccess(user: AuthUser): string {
    return this.jwt.sign(
      { sub: user.id, name: user.name, email: user.email, role: user.role },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
      } as JwtSignOptions,
    );
  }

  private signRefresh(user: { id: number }): { token: string; jti: string } {
    const jti = randomUUID();
    const token = this.jwt.sign({ sub: user.id, jti }, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
    } as JwtSignOptions);
    return { token, jti };
  }

  private refreshKey(userId: number, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  /** Sign a fresh access+refresh pair, persist the refresh jti, and set cookies. */
  async issueAuthCookies(res: Response, user: AuthUser): Promise<void> {
    const access = this.signAccess(user);
    const { token: refresh, jti } = this.signRefresh(user);
    await this.redis.set(
      this.refreshKey(user.id, jti),
      '1',
      'EX',
      REFRESH_TTL_SECONDS,
    );
    this.setAuthCookies(res, access, refresh);
  }

  /**
   * Validate the incoming refresh jti, rotate it (delete old, issue new), and
   * set new cookies. Throws 401 if the jti is unknown/revoked.
   */
  async rotateAuthCookies(
    res: Response,
    payload: { id: number; jti: string },
    user: AuthUser,
  ): Promise<void> {
    const key = this.refreshKey(payload.id, payload.jti);
    const exists = await this.redis.get(key);
    if (!exists) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }
    await this.redis.del(key);
    await this.issueAuthCookies(res, user);
  }

  /**
   * Sign a short-lived state token bound to the user initiating a Google link.
   * Passed as the OAuth `state` param and echoed back by Google, it lets the
   * callback trust the initiator's id (CSRF defense) instead of an ambient
   * cookie. See verifyLinkState.
   */
  signLinkState(userId: number): string {
    return this.jwt.sign({ sub: userId }, {
      secret: process.env.LINK_STATE_SECRET,
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
        secret: process.env.LINK_STATE_SECRET,
      });
      return { id: payload.sub };
    } catch {
      throw new UnauthorizedException('Invalid or expired link state');
    }
  }

  setAuthCookies(res: Response, access: string, refresh: string): void {
    const base = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      domain: process.env.COOKIE_DOMAIN,
    };
    res.cookie('access_token', access, { ...base, maxAge: ACCESS_MAX_AGE_MS });
    res.cookie('refresh_token', refresh, {
      ...base,
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }

  clearAuthCookies(res: Response): void {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
  }
}

export type { AccessPayload, RefreshPayload };
