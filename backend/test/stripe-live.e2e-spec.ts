// backend/test/stripe-live.e2e-spec.ts
//
// Opt-in test against the REAL Stripe test-mode API — not run by `npm run test:e2e`.
// Run with `npm run test:e2e:stripe-live`. Requires:
//   - the Stripe CLI installed and on PATH (confirmed present: 1.43.x)
//   - backend/.env.test.stripe-live with a real STRIPE_SECRET_KEY=sk_test_...
// See docs/superpowers/plans/2026-07-15-stripe-live-testing.md for the full design.

jest.unmock('stripe');

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, ReservationStatus } from '@prisma/client';
import { createTestApp, baseUrl } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { connectSocket, joinScreening, waitForEvent } from './support/socket';
import { createTestPrismaClient } from './support/prisma';
import { startWebhookRelay, triggerCheckoutCompleted, WebhookRelay } from './support/stripe-cli';

describe('Payments (live Stripe e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let relay: WebhookRelay;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrismaClient();

    const apiKey = process.env.STRIPE_SECRET_KEY as string;
    relay = await startWebhookRelay(`${baseUrl(app)}/api/v1/payments/webhook`, apiKey);
    process.env.STRIPE_WEBHOOK_SECRET = relay.webhookSecret;
  });

  afterAll(async () => {
    relay?.stop();
    await closeRedis();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
  });

  it('a real checkout session, completed via a real Stripe-relayed webhook, confirms the reservation and broadcasts seat:booked', async () => {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, {
      movieId: movie.id,
      hallId: hall.id,
      startTime: new Date(Date.now() + 72 * 60 * 60_000),
    });
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });
    const reservationId = reserveRes.body.id as number;

    const checkoutRes = await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });
    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });

    const socket = await connectSocket(baseUrl(app));
    try {
      await joinScreening(socket, screening.id);
      const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:booked', 30_000);

      triggerCheckoutCompleted(payment.id, process.env.STRIPE_SECRET_KEY as string);

      const payload = await broadcast;
      expect(payload.seatIds).toEqual([seats[0].id]);

      const confirmedReservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
      });
      expect(confirmedReservation.status).toBe(ReservationStatus.CONFIRMED);
    } finally {
      socket.disconnect();
    }
  }, 45_000);
});