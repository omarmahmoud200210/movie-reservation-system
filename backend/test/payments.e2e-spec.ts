import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, PaymentStatus, ReservationStatus } from '@prisma/client';
import { createTestApp, baseUrl } from './support/app';
import { resetState, closeRedis } from './support/db';
import { createAuthedUser } from './support/auth';
import { createHallWithSeats, createPublishedMovie, createScreening } from './support/fixtures';
import { connectSocket, joinScreening, waitForEvent } from './support/socket';
import { signWebhookPayload } from './support/stripe-webhook';
import { createTestPrismaClient } from './support/prisma';
import { PaymentsService } from '../src/payments/payments.service';

describe('Payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stripeMock: {
    checkout: { sessions: { create: jest.Mock; retrieve: jest.Mock } };
    refunds: { create: jest.Mock };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrismaClient();
    const paymentsService = app.get(PaymentsService);
    stripeMock = (paymentsService as unknown as { stripe: typeof stripeMock }).stripe;
  });

  afterAll(async () => {
    await closeRedis();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetState(prisma);
    jest.clearAllMocks();
  });

  async function seedHeldReservation(startTime: Date) {
    const { hall, seats } = await createHallWithSeats(prisma, { rows: 1, seatsPerRow: 1 });
    const movie = await createPublishedMovie(prisma);
    const screening = await createScreening(prisma, { movieId: movie.id, hallId: hall.id, startTime });
    const user = await createAuthedUser(prisma);

    const reserveRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Cookie', user.cookie)
      .send({ screeningId: screening.id, seatId: seats[0].id });

    return { user, screening, seat: seats[0], reservationId: reserveRes.body.id as number };
  }

  it('creates a checkout session and extends the hold', async () => {
    const { user, reservationId } = await seedHeldReservation(new Date(Date.now() + 72 * 60 * 60_000));
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/cs_test_1',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });

    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://checkout.stripe.com/cs_test_1');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });
    expect(payment.stripeSessionId).toBe('cs_test_1');
  });

  it('a real-signed checkout.session.completed (paid) webhook confirms the reservation and broadcasts seat:booked', async () => {
    const { user, screening, seat, reservationId } = await seedHeldReservation(
      new Date(Date.now() + 72 * 60 * 60_000),
    );
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_2',
      url: 'https://checkout.stripe.com/cs_test_2',
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });

    const socket = await connectSocket(baseUrl(app));
    try {
      await joinScreening(socket, screening.id);
      const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:booked');

      const { body, signature } = signWebhookPayload({
        id: 'evt_test_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            payment_status: 'paid',
            payment_intent: 'pi_test_1',
            metadata: { paymentId: String(payment.id) },
          },
        },
      });

      const webhookRes = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', signature)
        .set('Content-Type', 'application/json')
        .send(body);

      expect(webhookRes.status).toBe(201);
      const confirmedReservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
      });
      expect(confirmedReservation.status).toBe(ReservationStatus.CONFIRMED);

      const payload = await broadcast;
      expect(payload.seatIds).toEqual([seat.id]);
    } finally {
      socket.disconnect();
    }
  });

  it('rejects a webhook with a bad signature with 400 and does not change payment status', async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_3',
      url: 'https://checkout.stripe.com/cs_test_3',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'not_a_real_signature')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed' }));

    expect(res.status).toBe(400);
  });

  it('cancelling a CONFIRMED reservation >48h out refunds in full via Stripe and cancels it', async () => {
    const { user, reservationId } = await seedHeldReservation(new Date(Date.now() + 72 * 60 * 60_000));
    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_4',
      url: 'https://checkout.stripe.com/cs_test_4',
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments/checkout-session')
      .set('Cookie', user.cookie)
      .send({ reservationId });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });
    const { body, signature } = signWebhookPayload({
      id: 'evt_test_confirm',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          payment_intent: 'pi_test_confirm',
          metadata: { paymentId: String(payment.id) },
        },
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body);

    stripeMock.refunds.create.mockResolvedValue({ id: 're_test_1' });

    const cancelRes = await request(app.getHttpServer())
      .delete(`/api/v1/reservations/${reservationId}`)
      .set('Cookie', user.cookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe(ReservationStatus.CANCELLED);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test_confirm' }),
      expect.anything(),
    );

    const refundedPayment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });
    expect(refundedPayment.status).toBe(PaymentStatus.REFUNDED);
  });

  it('reconciliation confirms a TIMED_OUT payment Stripe reports as paid, and broadcasts seat:booked', async () => {
    const { screening, seat, reservationId } = await seedHeldReservation(
      new Date(Date.now() + 72 * 60 * 60_000),
    );
    const payment = await prisma.payment.create({
      data: {
        reservationId,
        amount: 5000,
        currency: 'usd',
        status: PaymentStatus.TIMED_OUT,
        stripeSessionId: 'cs_stuck_1',
        createdAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: 'paid',
      payment_intent: 'pi_reconciled_1',
    });

    const socket = await connectSocket(baseUrl(app));
    try {
      await joinScreening(socket, screening.id);
      const broadcast = waitForEvent<{ seatIds: number[] }>(socket, 'seat:booked');

      const paymentsService = app.get(PaymentsService);
      await paymentsService.reconcileTimedOutPayments();

      const payload = await broadcast;
      expect(payload.seatIds).toEqual([seat.id]);

      const reconciled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(reconciled.status).toBe(PaymentStatus.SUCCEEDED);
    } finally {
      socket.disconnect();
    }
  });
});
