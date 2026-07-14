// backend/test/reservations.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, ReservationStatus } from '@prisma/client';
import { createTestApp, baseUrl } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { connectSocket, joinScreening, waitForEvent } from './support/socket';
import { createTestPrismaClient } from './support/prisma';
import { HoldExpiryCron } from '../src/cron/hold-expiry.cron';

describe('Reservations (e2e)', () => {
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

  async function seedScreening() {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 2 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
    });
    return { hall, seats, movie, screening };
  }

  it('reserves a seat, then rejects a second reservation on the same seat with 409', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);
    const otherUser = await createAuthedUser(prisma);

    const firstRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });
    expect(firstRes.status).toBe(201);
    expect(firstRes.body.status).toBe(ReservationStatus.HELD);

    const secondRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', otherUser.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });
    expect(secondRes.status).toBe(409);
  });

  it('cancels a HELD reservation', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });

    const cancelRes = await request(app.getHttpServer())
      .delete(`/api/v1/reservations/${reserveRes.body.id}`)
      .set('Cookie', user.cookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe(ReservationStatus.CANCELLED);
  });

  it('broadcasts seat:reserved over the screening room on reserve', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);
    const socket = await connectSocket(baseUrl(app));
    try {
      await joinScreening(socket, screening.id);
      const broadcast = waitForEvent<{ seatIds: number[]; status: string }>(socket, 'seat:reserved');

      await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set('Cookie', user.cookie)
        .send({ screeningId: screening.id, seatId: seats[0].id });

      const payload = await broadcast;
      expect(payload.seatIds).toEqual([seats[0].id]);
      expect(payload.status).toBe('HELD');
    } finally {
      socket.disconnect();
    }
  });

  it('hold-expiry cron releases an expired HELD reservation and broadcasts seat:cancelled', async () => {
    const { seats, screening } = await seedScreening();
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });

    await prisma.reservation.update({
      where: { id: reserveRes.body.id },
      data: { heldUntil: new Date(Date.now() - 60_000) },
    });

    const socket = await connectSocket(baseUrl(app));
    try {
      await joinScreening(socket, screening.id);
      const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:cancelled');

      const cron = app.get(HoldExpiryCron);
      await cron.handleExpireHolds();

      const payload = await broadcast;
      expect(payload.seatIds).toEqual([seats[0].id]);

      const reservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: reserveRes.body.id },
      });
      expect(reservation.status).toBe(ReservationStatus.CANCELLED);
    } finally {
      socket.disconnect();
    }
  });
});
