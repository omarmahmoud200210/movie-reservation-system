import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, PaymentStatus, ReservationStatus } from '@prisma/client';
import { PaymentsService } from '../payments.service';
import { PaymentsRepository } from '../payments.repository';
import { ReservationsService } from '../../reservations/reservations.service';
import { ScreeningsRepository } from '../../screenings/screenings.repository';
import PaymentAbuseService from '../../redis/payment-abuse.service';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn(),
        retrieve: jest.fn(),
      },
    },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }));
});

const mockPaymentsRepo = {
  findByReservationId: jest.fn(),
  findByStripeEventId: jest.fn(),
  findByStripePaymentId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findStuckTimedOut: jest.fn(),
  findRefundPolicy: jest.fn(),
};
const mockReservationsService = {
  findOwned: jest.fn(),
  getById: jest.fn(),
  extendHold: jest.fn(),
  confirmPayment: jest.fn(),
  finalizeCancel: jest.fn(),
};
const mockScreeningsRepo = { findById: jest.fn() };
const mockPaymentAbuse = { recordFailure: jest.fn() };

const screening = { id: 3, price: 50, startTime: new Date('2026-07-10T18:00:00.000Z') };
const heldReservation = { id: 100, screeningId: 3, seatId: 11, status: ReservationStatus.HELD, userId: 7 };

describe('PaymentsService', () => {
  let service: PaymentsService;
  let stripeMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'http://localhost:5173';
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsRepository, useValue: mockPaymentsRepo },
        { provide: ReservationsService, useValue: mockReservationsService },
        { provide: ScreeningsRepository, useValue: mockScreeningsRepo },
        { provide: PaymentAbuseService, useValue: mockPaymentAbuse },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    stripeMock = (service as any).stripe;
  });

  describe('createCheckoutSession', () => {
    it('creates a Payment row, a Stripe session, and extends the hold', async () => {
      mockReservationsService.findOwned.mockResolvedValue(heldReservation);
      mockPaymentsRepo.findByReservationId.mockResolvedValue(null);
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockPaymentsRepo.create.mockResolvedValue({ id: 1, reservationId: 100 });
      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: 'cs_123',
        url: 'https://checkout.stripe.com/cs_123',
      });

      const result = await service.createCheckoutSession(7, 100);

      expect(result).toEqual({ url: 'https://checkout.stripe.com/cs_123' });
      expect(mockPaymentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId: 100,
          amount: 5000,
          currency: 'usd',
          status: PaymentStatus.PENDING,
        }),
      );
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          success_url: expect.stringContaining('/reservations/success'),
          cancel_url: 'http://localhost:5173/reservations',
          metadata: { paymentId: '1' },
        }),
      );
      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, { stripeSessionId: 'cs_123' });
      const expiresAtSeconds = stripeMock.checkout.sessions.create.mock.calls[0][0].expires_at;
      expect(mockReservationsService.extendHold).toHaveBeenCalledWith(
        100,
        new Date(expiresAtSeconds * 1000),
      );
    });

    it('throws 409 when the reservation is not HELD', async () => {
      mockReservationsService.findOwned.mockResolvedValue({
        ...heldReservation,
        status: ReservationStatus.CONFIRMED,
      });

      await expect(service.createCheckoutSession(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPaymentsRepo.create).not.toHaveBeenCalled();
    });

    it('throws 409 when a Payment already exists for the reservation', async () => {
      mockReservationsService.findOwned.mockResolvedValue(heldReservation);
      mockPaymentsRepo.findByReservationId.mockResolvedValue({ id: 1 });

      await expect(service.createCheckoutSession(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPaymentsRepo.create).not.toHaveBeenCalled();
    });

    it('propagates the 404 from findOwned for a non-owned/missing reservation', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockReservationsService.findOwned.mockRejectedValue(new NotFoundException());

      await expect(service.createCheckoutSession(7, 999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 409 when the screening no longer exists', async () => {
      mockReservationsService.findOwned.mockResolvedValue(heldReservation);
      mockPaymentsRepo.findByReservationId.mockResolvedValue(null);
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.createCheckoutSession(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPaymentsRepo.create).not.toHaveBeenCalled();
    });

    it('deletes the orphaned Payment row and rethrows when Stripe session creation fails', async () => {
      mockReservationsService.findOwned.mockResolvedValue(heldReservation);
      mockPaymentsRepo.findByReservationId.mockResolvedValue(null);
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockPaymentsRepo.create.mockResolvedValue({ id: 1, reservationId: 100 });
      const stripeError = new Error('Stripe API is down');
      stripeMock.checkout.sessions.create.mockRejectedValue(stripeError);

      await expect(service.createCheckoutSession(7, 100)).rejects.toThrow(stripeError);

      expect(mockPaymentsRepo.delete).toHaveBeenCalledWith(1);
      expect(mockReservationsService.extendHold).not.toHaveBeenCalled();
    });

    it('throws ConflictException when concurrent Payment creation races on the unique constraint', async () => {
      mockReservationsService.findOwned.mockResolvedValue(heldReservation);
      mockPaymentsRepo.findByReservationId.mockResolvedValue(null);
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPaymentsRepo.create.mockRejectedValue(p2002);

      await expect(service.createCheckoutSession(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookEvent', () => {
    const rawBody = Buffer.from('{}');
    const signature = 'sig_test';

    it('throws 400 on signature verification failure, writes nothing', async () => {
      const { BadRequestException } = require('@nestjs/common');
      stripeMock.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('bad signature');
      });

      await expect(
        service.handleWebhookEvent(rawBody, signature),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPaymentsRepo.update).not.toHaveBeenCalled();
    });

    it('no-ops on a duplicate stripeEventId', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({ id: 'evt_1', type: 'checkout.session.completed' });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue({ id: 1 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).not.toHaveBeenCalled();
    });

    it('checkout.session.completed (paid) -> SUCCEEDED, confirms the reservation', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: {
          object: {
            payment_status: 'paid',
            payment_intent: 'pi_1',
            metadata: { paymentId: '1' },
          },
        },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
      mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.SUCCEEDED,
        stripeEventId: 'evt_2',
        stripePaymentId: 'pi_1',
      });
      expect(mockReservationsService.confirmPayment).toHaveBeenCalledWith(100);
    });

    it('checkout.session.completed (unpaid, async) -> IN_PROGRESS, reservation untouched', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_3',
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'unpaid', metadata: { paymentId: '1' } } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.IN_PROGRESS,
        stripeEventId: 'evt_3',
      });
      expect(mockReservationsService.confirmPayment).not.toHaveBeenCalled();
    });

    it('checkout.session.async_payment_failed -> FAILED, records an abuse failure', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_4',
        type: 'checkout.session.async_payment_failed',
        data: { object: { metadata: { paymentId: '1' } } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
      mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });
      mockReservationsService.getById.mockResolvedValue({ id: 100, userId: 7 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.FAILED,
        stripeEventId: 'evt_4',
      });
      expect(mockPaymentAbuse.recordFailure).toHaveBeenCalledWith(7);
    });

    it('checkout.session.expired -> TIMED_OUT', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_5',
        type: 'checkout.session.expired',
        data: { object: { metadata: { paymentId: '1' } } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        status: PaymentStatus.TIMED_OUT,
        stripeEventId: 'evt_5',
      });
    });

    it('charge.dispute.created -> sets disputed fields, status unchanged', async () => {
      stripeMock.webhooks.constructEvent.mockReturnValue({
        id: 'evt_6',
        type: 'charge.dispute.created',
        data: { object: { payment_intent: 'pi_1', reason: 'fraudulent' } },
      });
      mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
      mockPaymentsRepo.findByStripePaymentId.mockResolvedValue({ id: 1 });

      await service.handleWebhookEvent(rawBody, signature);

      expect(mockPaymentsRepo.update).toHaveBeenCalledWith(1, {
        disputed: true,
        disputeReason: 'fraudulent',
        disputedAt: expect.any(Date),
        stripeEventId: 'evt_6',
      });
    });
  });
});
