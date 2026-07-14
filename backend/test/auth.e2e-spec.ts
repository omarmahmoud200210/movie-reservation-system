// backend/test/auth.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createTestPrismaClient } from './support/prisma';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await closeRedis();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in a verified user and sets the access_token cookie', async () => {
      await prisma.user.create({
        data: {
          name: 'Login User',
          email: 'login@test.local',
          password: await bcrypt.hash('Password123!', 10),
          emailVerified: true,
          role: 'USER',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'login@test.local', password: 'Password123!' });

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
    });

    it('rejects a wrong password with 401', async () => {
      await prisma.user.create({
        data: {
          name: 'Login User',
          email: 'login2@test.local',
          password: await bcrypt.hash('Password123!', 10),
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
});
