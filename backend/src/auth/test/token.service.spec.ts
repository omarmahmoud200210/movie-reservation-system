import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { randomUUID } from 'crypto';

import { UserRole } from '@prisma/client';
import { TokenService } from '../token.service';
import RedisCache from '../../redis/redis.cache';
import { authEnv } from '../auth-env.config';

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
  role: UserRole.USER,
};

const mockJwt = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockMulti = {
  set: jest.fn().mockReturnThis(),
  sadd: jest.fn().mockReturnThis(),
  incr: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockClient = {
  eval: jest.fn(),
  smembers: jest.fn(),
  del: jest.fn(),
  multi: jest.fn().mockReturnValue(mockMulti),
};

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  getClient: jest.fn().mockReturnValue(mockClient),
};

describe('TokenService', () => {
  let service: TokenService;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.getClient.mockReturnValue(mockClient);
    mockClient.multi.mockReturnValue(mockMulti);
    mockMulti.set.mockReturnThis();
    mockMulti.sadd.mockReturnThis();
    mockMulti.exec.mockResolvedValue([]);

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
        {
          sub: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          ver: 0,
        },
        {
          secret: authEnv.jwtAccessSecret,
          expiresIn: authEnv.jwtAccessExpiresIn,
        },
      );
    });

    it('signs the refresh token with sub + generated jti, secret and expiry', async () => {
      await service.issueAuthCookies(res as unknown as Response, user);

      expect(mockJwt.sign).toHaveBeenNthCalledWith(
        2,
        { sub: user.id, jti: FIXED_JTI },
        {
          secret: authEnv.jwtRefreshSecret,
          expiresIn: authEnv.jwtRefreshExpiresIn,
        },
      );
    });

    it('persists the refresh jti in redis with the correct key and ttl', async () => {
      await service.issueAuthCookies(res as unknown as Response, user);

      expect(mockMulti.set).toHaveBeenCalledWith(
        `refresh:${user.id}:${FIXED_JTI}`,
        '1',
        'EX',
        REFRESH_TTL_SECONDS,
      );
      expect(mockMulti.sadd).toHaveBeenCalledWith(
        `refresh_sessions:${user.id}`,
        FIXED_JTI,
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
      mockRedis.getClient.mockReturnValue(mockClient);
      mockClient.eval.mockResolvedValue([1]);

      await service.rotateAuthCookies(
        res as unknown as Response,
        payload,
        user,
      );

      expect(mockRedis.getClient).toHaveBeenCalled();
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        2,
        `refresh:${payload.id}:${payload.jti}`,
        `refresh_sessions:${user.id}`,
        `refresh:${user.id}:${FIXED_JTI}`,
        String(REFRESH_TTL_SECONDS),
        payload.jti,
        FIXED_JTI,
      );
      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('throws UnauthorizedException and issues nothing when the key is missing', async () => {
      mockRedis.getClient.mockReturnValue(mockClient);
      mockClient.eval.mockResolvedValue([0]);

      await expect(
        service.rotateAuthCookies(res as unknown as Response, payload, user),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('setAuthCookies', () => {
    it('sets the access_token cookie with httpOnly, strict and 15m maxAge', () => {
      service.setAuthCookies(res as unknown as Response, 'a', 'r');

      expect(res.cookie).toHaveBeenCalledWith('access_token', 'a', {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        domain: 'localhost',
        maxAge: ACCESS_MAX_AGE_MS,
      });
    });

    it('sets the refresh_token cookie scoped to the refresh path with 7d maxAge', () => {
      service.setAuthCookies(res as unknown as Response, 'a', 'r');

      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'r', {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
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
        { secret: authEnv.linkStateSecret, expiresIn: '10m' },
      );
      expect(result).toBe('state-token');
    });
  });

  describe('verifyLinkState', () => {
    it('verifies the state token and returns the user id', () => {
      mockJwt.verify.mockReturnValue({ sub: user.id });

      const result = service.verifyLinkState('state-token');

      expect(mockJwt.verify).toHaveBeenCalledWith('state-token', {
        secret: authEnv.linkStateSecret,
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

      expect(res.clearCookie).toHaveBeenCalledWith(
        'access_token',
        expect.objectContaining({ domain: 'localhost' }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({
          path: REFRESH_COOKIE_PATH,
          domain: 'localhost',
        }),
      );
    });
  });

  describe('revokeAllSessions', () => {
    it('deletes every refresh key matching the user when keys exist', async () => {
      mockClient.smembers.mockResolvedValue(['jti-a', 'jti-b']);

      await service.revokeAllSessions(1);

      expect(mockClient.smembers).toHaveBeenCalledWith('refresh_sessions:1');
      expect(mockClient.del).toHaveBeenCalledWith(
        'refresh:1:jti-a',
        'refresh:1:jti-b',
        'refresh_sessions:1',
      );
    });

    it('no-ops cleanly when there are no matching keys', async () => {
      mockClient.smembers.mockResolvedValue([]);

      await service.revokeAllSessions(1);

      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });
});
