import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { randomUUID } from 'crypto';

import { TokenService } from '../token.service';
import RedisCache from '../../redis/redis.cache';

jest.mock('crypto', () => ({
  ...jest.requireActual<typeof import('crypto')>('crypto'),
  randomUUID: jest.fn(),
}));

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

const FIXED_JTI = 'fixed-jti-1234';

const user = {
  id: 1,
  email: 'john@example.com',
  name: 'John Doe',
  role: 'USER',
};

const mockJwt = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};

describe('TokenService', () => {
  let service: TokenService;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.FRONTEND_URL = 'http://localhost:5173';
    process.env.COOKIE_DOMAIN = 'localhost';
    process.env.LINK_STATE_SECRET = 'link-state-secret';
    process.env.NODE_ENV = 'test';

    (randomUUID as jest.Mock).mockReturnValue(FIXED_JTI);
    // signAccess is called before signRefresh in issueAuthCookies.
    mockJwt.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: mockJwt },
        { provide: RedisCache, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
  });

  describe('issueAuthCookies', () => {
    it('signs the access token with the access payload, secret and expiry', async () => {
      await service.issueAuthCookies(res as unknown as Response, user);

      expect(mockJwt.sign).toHaveBeenNthCalledWith(
        1,
        { sub: user.id, name: user.name, email: user.email, role: user.role },
        { secret: 'access-secret', expiresIn: '15m' },
      );
    });

    it('signs the refresh token with sub + generated jti, secret and expiry', async () => {
      await service.issueAuthCookies(res as unknown as Response, user);

      expect(mockJwt.sign).toHaveBeenNthCalledWith(
        2,
        { sub: user.id, jti: FIXED_JTI },
        { secret: 'refresh-secret', expiresIn: '7d' },
      );
    });

    it('persists the refresh jti in redis with the correct key and ttl', async () => {
      await service.issueAuthCookies(res as unknown as Response, user);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `refresh:${user.id}:${FIXED_JTI}`,
        '1',
        'EX',
        REFRESH_TTL_SECONDS,
      );
    });

    it('sets both auth cookies on the response', async () => {
      await service.issueAuthCookies(res as unknown as Response, user);

      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'access-token',
        expect.objectContaining({ maxAge: ACCESS_MAX_AGE_MS }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({ maxAge: REFRESH_MAX_AGE_MS }),
      );
    });
  });

  describe('rotateAuthCookies', () => {
    const payload = { id: user.id, jti: 'old-jti' };

    it('deletes the old refresh key and issues fresh cookies when the key exists', async () => {
      mockRedis.get.mockResolvedValue('1');

      await service.rotateAuthCookies(res as unknown as Response, payload, user);

      expect(mockRedis.get).toHaveBeenCalledWith(
        `refresh:${payload.id}:${payload.jti}`,
      );
      expect(mockRedis.del).toHaveBeenCalledWith(
        `refresh:${payload.id}:${payload.jti}`,
      );
      // New cookies issued: new jti persisted + cookies set.
      expect(mockRedis.set).toHaveBeenCalledWith(
        `refresh:${user.id}:${FIXED_JTI}`,
        '1',
        'EX',
        REFRESH_TTL_SECONDS,
      );
      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('throws UnauthorizedException and issues nothing when the key is missing', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(
        service.rotateAuthCookies(res as unknown as Response, payload, user),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('setAuthCookies', () => {
    it('sets the access_token cookie with httpOnly, lax and 15m maxAge', () => {
      service.setAuthCookies(res as unknown as Response, 'a', 'r');

      expect(res.cookie).toHaveBeenCalledWith('access_token', 'a', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        domain: 'localhost',
        maxAge: ACCESS_MAX_AGE_MS,
      });
    });

    it('sets the refresh_token cookie scoped to the refresh path with 7d maxAge', () => {
      service.setAuthCookies(res as unknown as Response, 'a', 'r');

      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'r', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        domain: 'localhost',
        path: REFRESH_COOKIE_PATH,
        maxAge: REFRESH_MAX_AGE_MS,
      });
    });
  });

  describe('signLinkState', () => {
    it('signs a short-lived state token bound to the user id', () => {
      mockJwt.sign.mockReset();
      mockJwt.sign.mockReturnValue('state-token');

      const result = service.signLinkState(user.id);

      expect(mockJwt.sign).toHaveBeenCalledWith(
        { sub: user.id },
        { secret: 'link-state-secret', expiresIn: '10m' },
      );
      expect(result).toBe('state-token');
    });
  });

  describe('verifyLinkState', () => {
    it('verifies the state token and returns the user id', () => {
      mockJwt.verify.mockReturnValue({ sub: user.id });

      const result = service.verifyLinkState('state-token');

      expect(mockJwt.verify).toHaveBeenCalledWith('state-token', {
        secret: 'link-state-secret',
      });
      expect(result).toEqual({ id: user.id });
    });

    it('throws UnauthorizedException when the state is missing', () => {
      expect(() => service.verifyLinkState(undefined)).toThrow(
        UnauthorizedException,
      );
      expect(mockJwt.verify).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the state is forged or expired', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      expect(() => service.verifyLinkState('forged')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('clearAuthCookies', () => {
    it('clears the access and refresh cookies (refresh with its path)', () => {
      service.clearAuthCookies(res as unknown as Response);

      expect(res.clearCookie).toHaveBeenCalledWith('access_token');
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', {
        path: REFRESH_COOKIE_PATH,
      });
    });
  });
});
