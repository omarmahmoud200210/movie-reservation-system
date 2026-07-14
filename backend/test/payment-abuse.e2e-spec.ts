// backend/test/payment-abuse.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { createTestPrismaClient } from './support/prisma';
import PaymentAbuseService from '../src/redis/payment-abuse.service';

describe('Payment abuse lockout (e2e)', () => {
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

  it('locks out reservation creation after 3 recorded payment failures', async () => {
    const user = await createAuthedUser(prisma);
    const { hall } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const seat = (await prisma.seat.findMany({ where: { hallId: hall.id } }))[0];

    const paymentAbuse = app.get(PaymentAbuseService);
    await paymentAbuse.recordFailure(user.id);
    await paymentAbuse.recordFailure(user.id);
    await paymentAbuse.recordFailure(user.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seat.id });

    expect(res.status).toBe(403);
  });

  it('does not lock out a user under the 3-failure threshold', async () => {
    const user = await createAuthedUser(prisma);
    const { hall } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const seat = (await prisma.seat.findMany({ where: { hallId: hall.id } }))[0];

    const paymentAbuse = app.get(PaymentAbuseService);
    await paymentAbuse.recordFailure(user.id);
    await paymentAbuse.recordFailure(user.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seat.id });

    expect(res.status).toBe(201);
  });
});
