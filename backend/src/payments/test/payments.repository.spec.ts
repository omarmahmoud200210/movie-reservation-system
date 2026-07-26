import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsRepository } from '../payments.repository';

const mockPrisma = {
  read: {
    payment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    refundPolicy: {
      findFirst: jest.fn(),
    },
  },
  write: {
    payment: {
      create: jest.fn(),
      update: jest.fn(),
    },
    reservation: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
};

describe('PaymentsRepository', () => {
  let repo: PaymentsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    repo = module.get<PaymentsRepository>(PaymentsRepository);
  });

  describe('findByReservationId', () => {
    it('looks up by the unique reservationId', async () => {
      mockPrisma.read.payment.findUnique.mockResolvedValue({ id: 1 });

      await repo.findByReservationId(100);

      expect(mockPrisma.read.payment.findUnique).toHaveBeenCalledWith({
        where: { reservationId: 100 },
      });
    });
  });

  describe('findById', () => {
    it('looks up by the primary key', async () => {
      mockPrisma.read.payment.findUnique.mockResolvedValue({ id: 1 });

      await repo.findById(1);

      expect(mockPrisma.read.payment.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });
  });

  describe('findByStripeEventId', () => {
    it('looks up by the unique stripeEventId', async () => {
      mockPrisma.read.payment.findUnique.mockResolvedValue(null);

      await repo.findByStripeEventId('evt_123');

      expect(mockPrisma.read.payment.findUnique).toHaveBeenCalledWith({
        where: { stripeEventId: 'evt_123' },
      });
    });
  });

  describe('findByStripePaymentId', () => {
    it('looks up by stripePaymentId', async () => {
      mockPrisma.read.payment.findFirst.mockResolvedValue({ id: 1 });

      await expect(repo.findByStripePaymentId('pi_123')).resolves.toEqual({
        id: 1,
      });

      expect(mockPrisma.read.payment.findFirst).toHaveBeenCalledWith({
        where: { stripePaymentId: 'pi_123' },
      });
    });

    it('returns null when no payment matches', async () => {
      mockPrisma.read.payment.findFirst.mockResolvedValue(null);

      await expect(
        repo.findByStripePaymentId('pi_missing'),
      ).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('creates a Payment row', async () => {
      const data = {
        reservationId: 100,
        amount: 5000,
        currency: 'usd',
        status: PaymentStatus.PENDING,
        stripeSessionId: '',
      };
      mockPrisma.write.payment.create.mockResolvedValue({ id: 1, ...data });

      await repo.create(data);

      expect(mockPrisma.write.payment.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('update', () => {
    it('updates a Payment row by id', async () => {
      mockPrisma.write.payment.update.mockResolvedValue({ id: 1 });

      await repo.update(1, { status: PaymentStatus.SUCCEEDED });

      expect(mockPrisma.write.payment.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: PaymentStatus.SUCCEEDED },
      });
    });
  });

  describe('findStuckTimedOut', () => {
    it('finds TIMED_OUT payments older than the cutoff', async () => {
      const cutoff = new Date('2026-07-07T00:00:00.000Z');
      mockPrisma.read.payment.findMany.mockResolvedValue([]);

      await repo.findStuckTimedOut(cutoff);

      expect(mockPrisma.read.payment.findMany).toHaveBeenCalledWith({
        where: { status: PaymentStatus.TIMED_OUT, createdAt: { lt: cutoff } },
      });
    });
  });

  describe('findRefundPolicy', () => {
    it('finds the policy whose [hoursFrom, hoursTo) range contains the value', async () => {
      mockPrisma.read.refundPolicy.findFirst.mockResolvedValue({
        refundPercent: 50,
      });

      await repo.findRefundPolicy(30);

      expect(mockPrisma.read.refundPolicy.findFirst).toHaveBeenCalledWith({
        where: { hoursFrom: { lte: 30 }, hoursTo: { gt: 30 } },
      });
    });
  });

  describe('confirmWithReservation', () => {
    it('confirms the payment and the reservation in one transaction', async () => {
      const payment = { id: 1, status: PaymentStatus.SUCCEEDED };
      const reservation = { id: 100, status: 'CONFIRMED' };
      mockPrisma.write.payment.update.mockReturnValue(payment);
      mockPrisma.write.reservation.update.mockReturnValue(reservation);
      mockPrisma.write.$transaction.mockResolvedValue([payment, reservation]);

      await expect(
        repo.confirmWithReservation(1, 100, 'pi_9'),
      ).resolves.toEqual({ payment, reservation });

      expect(mockPrisma.write.payment.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: PaymentStatus.SUCCEEDED, stripePaymentId: 'pi_9' },
      });
      expect(mockPrisma.write.reservation.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { status: 'CONFIRMED', heldUntil: null },
      });
      expect(mockPrisma.write.$transaction).toHaveBeenCalledWith([
        payment,
        reservation,
      ]);
    });
  });

  describe('declineWithReservation', () => {
    it('declines the payment and cancels the reservation in one transaction', async () => {
      const payment = { id: 2, status: PaymentStatus.DECLINED };
      const reservation = { id: 101, status: 'CANCELLED' };
      mockPrisma.write.payment.update.mockReturnValue(payment);
      mockPrisma.write.reservation.update.mockReturnValue(reservation);
      mockPrisma.write.$transaction.mockResolvedValue([payment, reservation]);

      await expect(repo.declineWithReservation(2, 101)).resolves.toEqual({
        payment,
        reservation,
      });

      expect(mockPrisma.write.payment.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { status: PaymentStatus.DECLINED },
      });
      expect(mockPrisma.write.reservation.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: { status: 'CANCELLED' },
      });
    });
  });
});
