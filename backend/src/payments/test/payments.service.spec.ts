import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PaymentStatus, ReservationStatus } from '@prisma/client';
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
      expect(mockReservationsService.extendHold).toHaveBeenCalledWith(100, expect.any(Date));
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
  });
});
