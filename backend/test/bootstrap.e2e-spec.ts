import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState, closeRedis } from './support/db';

describe('e2e harness sanity check', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toContain('movie_reservation_test');
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await closeRedis();
    await prisma.$disconnect();
    await app.close();
  });

  it('boots the real app and responds on a public route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/movies');
    expect(res.status).toBe(200);
  });

  it('resetState truncates and re-seeds RefundPolicy', async () => {
    await resetState(prisma);
    const policies = await prisma.refundPolicy.findMany();
    expect(policies).toHaveLength(3);
  });

  it('the Stripe mock is active (webhooks real, API calls stubbed)', async () => {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    expect(jest.isMockFunction(stripe.checkout.sessions.create)).toBe(true);
    expect(typeof stripe.webhooks.constructEvent).toBe('function');
  });
});
