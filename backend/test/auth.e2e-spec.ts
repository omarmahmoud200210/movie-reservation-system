// backend/test/auth.e2e-spec.ts
/**
 * Replaces passport-google-oauth20's Strategy with a fake that drives the
 * real GoogleAuthGuard/GoogleStrategy/callback pipeline without a live OAuth
 * handshake: initiation endpoints get a 302 to Google; callback endpoints
 * validate through the strategy's `validate()` using a canned profile (email
 * read from the `email` query param). This keeps the redirect + cookie + audit
 * wiring under test without real Google credentials.
 */
jest.mock('passport-google-oauth20', () => {
  const passport = jest.requireActual('passport');
  class MockGoogleStrategy extends passport.Strategy {
    options: { callbackURL: string };
    verify: (...args: unknown[]) => void;

    constructor(
      options: { callbackURL: string },
      verify: (...args: unknown[]) => void,
    ) {
      super();
      this.options = options;
      this.verify = verify;
    }

    authenticate(req: { url?: string }): void {
      const url = req.url ?? '';
      if (!url.includes('callback')) {
        this.redirect(
          `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(
            this.options.callbackURL,
          )}`,
        );
        return;
      }
      const query = new URL(url, 'http://localhost');
      const code = query.searchParams.get('code');
      if (!code) {
        this.error(new Error('Missing auth code'));
        return;
      }
      const email = query.searchParams.get('email') ?? 'oauth-new@test.local';
      const profile = {
        id: 'google-profile-id',
        displayName: 'OAuth Test User',
        emails: [{ value: email }],
      };
      this.verify(null, null, profile, (err: unknown, user: unknown) => {
        if (err) this.error(err);
        else this.success(user);
      });
    }
  }
  return {
    __esModule: true,
    default: { Strategy: MockGoogleStrategy },
    Strategy: MockGoogleStrategy,
  };
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createTestPrismaClient } from './support/prisma';
import { TestMailerService } from './support/mailer';
import { MailerService } from '../src/mailer/mailer.service';

const PASSWORD = 'Password123!';

/** Pulls the raw cookie header value for `name` out of a set-cookie array. */
function cookieValue(setCookie: string[] | undefined, name: string): string {
  const entry = (setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  return entry ? entry.split(';')[0].slice(name.length + 1) : '';
}

/** Names present in a set-cookie array (used to assert clearing on logout). */
function presentCookieNames(setCookie: string[] | undefined): string[] {
  return (setCookie ?? []).map((c) => c.split('=')[0]);
}

/** Set-Cookie headers mapped back to a `name=value` Cookie header string. */
function cookieHeader(setCookie: string[]): string {
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const mailer = new TestMailerService();

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [{ provide: MailerService, useValue: mailer }],
    });
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await closeRedis();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    mailer.codes.clear();
    await resetState(prisma);
  });

  async function registerVia(email: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Auth E2E User', email, password: PASSWORD });
  }

  async function verifyOtp(email: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ email, code: mailer.getOtp(email) });
  }

  describe('POST /api/v1/auth/login', () => {
    it('logs in a verified user and sets the access_token cookie', async () => {
      await prisma.user.create({
        data: {
          name: 'Login User',
          email: 'login@test.local',
          password: await argon2.hash(PASSWORD),
          emailVerified: true,
          role: 'USER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'login@test.local', password: PASSWORD });

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
    });

    it('rejects a wrong password with 401', async () => {
      await prisma.user.create({
        data: {
          name: 'Login User',
          email: 'login2@test.local',
          password: await argon2.hash(PASSWORD),
          emailVerified: true,
          role: 'USER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'login2@test.local', password: 'WrongPassword!' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns the caller with a valid cookie from createAuthedUser', async () => {
      const testUser = await createAuthedUser(prisma);

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', testUser.cookie);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testUser.email);
    });
  });

  describe('registration → OTP → verify → auto-login', () => {
    it('registers, mails a 6-digit code, and auto-logs-in on verify', async () => {
      const email = 'otp-flow@test.local';

      const reg = await registerVia(email);
      expect(reg.status).toBe(201);
      expect(reg.body.message).toMatch(/code was sent/i);

      const row = await prisma.user.findUnique({
        where: { email },
        select: { emailVerified: true },
      });
      expect(row).not.toBeNull();
      expect(row!.emailVerified).toBe(false);

      const code = mailer.getOtp(email);
      expect(code).toMatch(/^\d{6}$/);

      const ver = await verifyOtp(email);
      expect(ver.status).toBe(200);
      expect(ver.body.email).toBe(email);

      const setCookie = (ver.headers['set-cookie'] ??
        []) as unknown as string[];
      expect(presentCookieNames(setCookie)).toEqual(
        expect.arrayContaining(['access_token', 'refresh_token']),
      );

      const verified = await prisma.user.findUnique({
        where: { email },
        select: { emailVerified: true },
      });
      expect(verified!.emailVerified).toBe(true);

      // Returned cookies are valid at /me.
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', cookieHeader(setCookie));
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(email);
    });

    it('does not leak whether an email is already registered', async () => {
      const email = 'second@test.local';
      const first = await registerVia(email);
      const second = await registerVia(email);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.message).toBe(first.body.message);
    });

    it('rejects a wrong OTP code with 400', async () => {
      const email = 'wrong-otp@test.local';
      await registerVia(email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ email, code: '000000' });
      expect(res.status).toBe(400);
    });

    it('rejects verify-otp for an unknown email with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'nobody@test.local', code: '123456' });
      expect(res.status).toBe(400);
    });

    it('rejects login for an unverified account with 403', async () => {
      const email = 'unverified@test.local';
      await registerVia(email);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(403);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token and rejects reuse of the old one', async () => {
      const email = 'refresh@test.local';
      await registerVia(email);
      const ver = await verifyOtp(email);
      expect(ver.status).toBe(200);

      const verCookies = (ver.headers['set-cookie'] ??
        []) as unknown as string[];
      const oldRefresh = cookieValue(verCookies, 'refresh_token');
      const oldAccess = cookieValue(verCookies, 'access_token');
      expect(oldRefresh).not.toBe('');

      // First refresh with the valid old cookie → 200 + a new token pair.
      const r1 = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${oldRefresh}`);
      expect(r1.status).toBe(200);
      expect(r1.body.message).toBe('Token refreshed');

      const r1Cookies = (r1.headers['set-cookie'] ?? []) as unknown as string[];
      const newRefresh = cookieValue(r1Cookies, 'refresh_token');
      const newAccess = cookieValue(r1Cookies, 'access_token');
      expect(newRefresh).not.toBe('');
      expect(newAccess).not.toBe('');

      // Fresh access token validates at /me.
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `access_token=${newAccess}`);
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(email);

      // Reusing the now-consumed old refresh token must be rejected (theft
      // detection in the rotate Lua script).
      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${oldRefresh}`);
      expect(replay.status).toBe(401);
      // The old access token is unrelated and is NOT invalidated by rotation.
      expect(oldAccess).not.toBe('');
    });

    it('rejects refresh without a cookie', async () => {
      const res = await request(app.getHttpServer()).post(
        '/api/v1/auth/refresh',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('clears cookies and revokes refresh sessions', async () => {
      const email = 'logout@test.local';
      const server = app.getHttpServer();
      await registerVia(email);
      const ver = await verifyOtp(email);
      const verCookies = (ver.headers['set-cookie'] ??
        []) as unknown as string[];
      const refreshToken = cookieValue(verCookies, 'refresh_token');
      expect(refreshToken).not.toBe('');

      const out = await request(server)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieHeader(verCookies));
      expect(out.status).toBe(200);

      const cleared = presentCookieNames(
        (out.headers['set-cookie'] as unknown as string[]) ?? [],
      );
      expect(cleared).toEqual(
        expect.arrayContaining(['access_token', 'refresh_token']),
      );

      // No cookies remain in the agent jar → /me is unauthenticated.
      const me = await request(server).get('/api/v1/auth/me');
      expect(me.status).toBe(401);

      // The revoked refresh token can no longer be used.
      const replay = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);
      expect(replay.status).toBe(401);
    });
  });

  describe('Google OAuth', () => {
    it('redirects to Google consent on /auth/google', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/google');
      expect(res.status).toBe(302);
      expect(String(res.headers.location)).toContain('accounts.google.com');
    });

    it('errors on /auth/google/callback without a code', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/auth/google/callback',
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('creates a new Google user, sets cookies, redirects to frontend', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/auth/google/callback?code=fake&email=oauth-new@test.local',
      );
      expect(res.status).toBe(302);
      expect(String(res.headers.location)).toContain('/auth/google/callback');

      const setCookie = (res.headers['set-cookie'] ??
        []) as unknown as string[];
      expect(presentCookieNames(setCookie)).toEqual(
        expect.arrayContaining(['access_token', 'refresh_token']),
      );

      const created = await prisma.user.findUnique({
        where: { email: 'oauth-new@test.local' },
        select: { emailVerified: true, googleId: true },
      });
      expect(created).not.toBeNull();
      expect(created!.emailVerified).toBe(true);
      expect(created!.googleId).toBe('google-profile-id');
    });

    it('redirects to login with error when email belongs to a manual account', async () => {
      await prisma.user.create({
        data: {
          name: 'Existing User',
          email: 'oauth-new@test.local',
          password: await argon2.hash(PASSWORD),
          emailVerified: true,
          role: 'USER',
        },
      });

      const res = await request(app.getHttpServer()).get(
        '/api/v1/auth/google/callback?code=fake&email=oauth-new@test.local',
      );
      expect(res.status).toBe(302);
      expect(String(res.headers.location)).toContain(
        'login?error=account_exists',
      );
    });
  });

  describe('rate limiting (Redis-backed IP middleware)', () => {
    it('limits /auth/register to 3 per minute', async () => {
      const server = app.getHttpServer();
      let status = 0;
      for (let i = 0; i < 4; i++) {
        const res = await request(server)
          .post('/api/v1/auth/register')
          .send({
            name: 'RL',
            email: `rl-register-${i}@test.local`,
            password: PASSWORD,
          });
        status = res.status;
      }
      expect(status).toBe(429);
    });

    it('limits /auth/login to 5 per 15 minutes', async () => {
      await prisma.user.create({
        data: {
          name: 'RL User',
          email: 'rl-login@test.local',
          password: await argon2.hash(PASSWORD),
          emailVerified: true,
          role: 'USER',
        },
      });
      const server = app.getHttpServer();
      let status = 0;
      for (let i = 0; i < 6; i++) {
        const res = await request(server)
          .post('/api/v1/auth/login')
          .send({ email: 'rl-login@test.local', password: 'Wrong!' });
        status = res.status;
      }
      expect(status).toBe(429);
    });

    it('sets a Retry-After header on 429', async () => {
      const server = app.getHttpServer();
      let last: request.Response | undefined;
      for (let i = 0; i < 4; i++) {
        const res = await request(server)
          .post('/api/v1/auth/register')
          .send({
            name: 'RL',
            email: `rl-rt-${i}@test.local`,
            password: PASSWORD,
          });
        last = res;
      }
      expect(last!.status).toBe(429);
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    });
  });
});
