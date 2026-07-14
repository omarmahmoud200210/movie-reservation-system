import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { createTestPrismaClient } from './support/prisma';

describe('Screenings (e2e)', () => {
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

  it('GET /api/v1/screenings/:id/seats returns the hall seat map', async () => {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 3 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });

    const res = await request(app.getHttpServer()).get(
      `/api/v1/screenings/${screening.id}/seats`,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(seats.length);
  });

  it('POST /api/v1/screenings rejects a non-admin with 403', async () => {
    const user = await createAuthedUser(prisma, { role: 'USER' });
    const { hall } = await createHallWithSeats(prisma);
    const movie = await createPublishedMovie(prisma);

    const res = await request(app.getHttpServer())
      .post('/api/v1/screenings')
      .set('Cookie', user.cookie)
      .send({
        movieId: movie.id,
        hallId: hall.id,
        startTime: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        price: 50,
      });

    expect(res.status).toBe(403);
  });

  it('an ADMIN can create a screening', async () => {
    const admin = await createAuthedUser(prisma, { role: 'ADMIN' });
    const { hall } = await createHallWithSeats(prisma);
    const movie = await createPublishedMovie(prisma);

    const res = await request(app.getHttpServer())
      .post('/api/v1/screenings')
      .set('Cookie', admin.cookie)
      .send({
        movieId: movie.id,
        hallId: hall.id,
        startTime: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        price: 50,
      });

    expect(res.status).toBe(201);
    expect(res.body.hallId).toBe(hall.id);
  });
});
