import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReservationsRepository } from '../reservations.repository';

// A `tx` client handed to the $transaction callback.
const mockTx = {
  $queryRaw: jest.fn(),
  reservation: {
    findMany: jest.fn(),
    createManyAndReturn: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  reservation: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};

const HELD_UNTIL = new Date('2026-07-02T12:10:00.000Z');
const holdParams = {
  userId: 7,
  screeningId: 3,
  hallId: 2,
  seatIds: [11, 12],
  heldUntil: HELD_UNTIL,
};

describe('ReservationsRepository', () => {
  let repo: ReservationsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Run the interactive transaction callback against mockTx.
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repo = module.get<ReservationsRepository>(ReservationsRepository);
  });

  describe('holdSeats', () => {
    it('locks the seats, inserts one HELD row per seat, and returns them', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      mockTx.reservation.findMany.mockResolvedValue([]);
      const created = [{ id: 100 }, { id: 101 }];
      mockTx.reservation.createManyAndReturn.mockResolvedValue(created);

      await expect(repo.holdSeats(holdParams)).resolves.toBe(created);

      expect(mockTx.reservation.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          {
            userId: 7,
            screeningId: 3,
            seatId: 11,
            status: ReservationStatus.HELD,
            heldUntil: HELD_UNTIL,
          },
          {
            userId: 7,
            screeningId: 3,
            seatId: 12,
            status: ReservationStatus.HELD,
            heldUntil: HELD_UNTIL,
          },
        ],
      });
    });

    it('throws 400 when a requested seat is not in the hall (lock returns fewer rows)', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]); // seat 12 missing

      await expect(repo.holdSeats(holdParams)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockTx.reservation.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('throws 409 when a seat is already actively reserved', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      mockTx.reservation.findMany.mockResolvedValue([{ seatId: 12 }]);

      await expect(repo.holdSeats(holdParams)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockTx.reservation.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('maps a unique-index violation (P2002) to 409', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      mockTx.reservation.findMany.mockResolvedValue([]);
      mockTx.reservation.createManyAndReturn.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(repo.holdSeats(holdParams)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('only checks HELD/CONFIRMED reservations for the requested seats', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      mockTx.reservation.findMany.mockResolvedValue([]);
      mockTx.reservation.createManyAndReturn.mockResolvedValue([]);

      await repo.holdSeats(holdParams);

      expect(mockTx.reservation.findMany).toHaveBeenCalledWith({
        where: {
          screeningId: 3,
          seatId: { in: [11, 12] },
          status: {
            in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
          },
        },
        select: { seatId: true },
      });
    });
  });

  describe('findById', () => {
    it('looks the reservation up by id', async () => {
      mockPrisma.reservation.findUnique.mockResolvedValue({ id: 5 });

      await repo.findById(5);

      expect(mockPrisma.reservation.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
      });
    });
  });

  describe('setStatus', () => {
    it('updates the reservation status by id', async () => {
      mockPrisma.reservation.update.mockResolvedValue({ id: 5 });

      await repo.setStatus(5, ReservationStatus.CANCELLED);

      expect(mockPrisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: ReservationStatus.CANCELLED },
      });
    });
  });

  describe('findByUser', () => {
    it('lists the user reservations newest first with seat + screening + movie', async () => {
      mockPrisma.reservation.findMany.mockResolvedValue([]);

      await repo.findByUser(7);

      expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
        where: { userId: 7 },
        include: {
          seat: true,
          screen: { include: { movie: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('releaseExpiredHolds', () => {
    it('runs the atomic RETURNING update and resolves with the released rows', async () => {
      const released = [
        { id: 100, screeningId: 3, seatId: 11 },
        { id: 101, screeningId: 3, seatId: 12 },
      ];
      mockPrisma.$queryRaw.mockResolvedValue(released);
      const now = new Date('2026-07-04T12:00:00.000Z');

      await expect(repo.releaseExpiredHolds(now)).resolves.toBe(released);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('resolves with an empty array when nothing has expired', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(
        repo.releaseExpiredHolds(new Date()),
      ).resolves.toEqual([]);
    });
  });
});
