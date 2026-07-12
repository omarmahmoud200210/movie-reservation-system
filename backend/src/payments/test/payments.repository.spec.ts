import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsRepository } from '../payments.repository';

const mockPrisma = {
  payment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  refundPolicy: {
    findFirst: jest.fn(),
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
      mockPrisma.payment.findUnique.mockResolvedValue({ id: 1 });

      await repo.findByReservationId(100);

      expect(mockPrisma.payment.findUnique).toHaveBeenCalledWith({
        where: { reservationId: 100 },
      });
    });
  });

  describe('findByStripeEventId', () => {
    it('looks up by the unique stripeEventId', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      await repo.findByStripeEventId('evt_123');

      expect(mockPrisma.payment.findUnique).toHaveBeenCalledWith({
        where: { stripeEventId: 'evt_123' },
      });
    });
  });

  describe('findByStripePaymentId', () => {
    it('looks up by stripePaymentId', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 1 });

      await expect(repo.findByStripePaymentId('pi_123')).resolves.toEqual({
        id: 1,
      });

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
        where: { stripePaymentId: 'pi_123' },
      });
    });

    it('returns null when no payment matches', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);

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
      mockPrisma.payment.create.mockResolvedValue({ id: 1, ...data });

      await repo.create(data);

      expect(mockPrisma.payment.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('update', () => {
    it('updates a Payment row by id', async () => {
      mockPrisma.payment.update.mockResolvedValue({ id: 1 });

      await repo.update(1, { status: PaymentStatus.SUCCEEDED });

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: PaymentStatus.SUCCEEDED },
      });
    });
  });

  describe('findStuckTimedOut', () => {
    it('finds TIMED_OUT payments older than the cutoff', async () => {
      const cutoff = new Date('2026-07-07T00:00:00.000Z');
      mockPrisma.payment.findMany.mockResolvedValue([]);

      await repo.findStuckTimedOut(cutoff);

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith({
        where: { status: PaymentStatus.TIMED_OUT, createdAt: { lt: cutoff } },
      });
    });
  });

  describe('findRefundPolicy', () => {
    it('finds the policy whose [hoursFrom, hoursTo) range contains the value', async () => {
      mockPrisma.refundPolicy.findFirst.mockResolvedValue({
        refundPercent: 50,
      });

      await repo.findRefundPolicy(30);

      expect(mockPrisma.refundPolicy.findFirst).toHaveBeenCalledWith({
        where: { hoursFrom: { lte: 30 }, hoursTo: { gt: 30 } },
      });
    });
  });
});
