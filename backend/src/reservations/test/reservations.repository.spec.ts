import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReservationsRepository } from '../reservations.repository';

// A `tx` client handed to the $transaction callback.
const mockTx = {
  $queryRaw: jest.fn(),
  reservation: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

const mockPrisma = {
  read: {
    reservation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
  write: {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    reservation: {
      update: jest.fn(),
    },
  },
};

const HELD_UNTIL = new Date('2026-07-02T12:10:00.000Z');
const holdParams = {
  userId: 7,
  screeningId: 3,
  hallId: 2,
  seatId: 11,
  heldUntil: HELD_UNTIL,
};

describe('ReservationsRepository', () => {
  let repo: ReservationsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Run the interactive transaction callback against mockTx.
    mockPrisma.write.$transaction.mockImplementation(
      (cb: (tx: unknown) => unknown) => cb(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repo = module.get<ReservationsRepository>(ReservationsRepository);
  });

  describe('holdSeat', () => {
    it('locks the seat, inserts one HELD row, and returns it', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
      mockTx.reservation.findFirst.mockResolvedValue(null);
      const created = { id: 100 };
      mockTx.reservation.create.mockResolvedValue(created);

      await expect(repo.holdSeat(holdParams)).resolves.toBe(created);

      expect(mockTx.reservation.create).toHaveBeenCalledWith({
        data: {
          userId: 7,
          screeningId: 3,
          seatId: 11,
          status: ReservationStatus.HELD,
          heldUntil: HELD_UNTIL,
        },
      });
    });

    it('throws 400 when the seat is not in the hall (lock returns no row)', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(repo.holdSeat(holdParams)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockTx.reservation.create).not.toHaveBeenCalled();
    });

    it('throws 409 when the seat is already actively reserved', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
      mockTx.reservation.findFirst.mockResolvedValue({ id: 55 });

      await expect(repo.holdSeat(holdParams)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockTx.reservation.create).not.toHaveBeenCalled();
    });

    it('maps a unique-index violation (P2002) to 409', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
      mockTx.reservation.findFirst.mockResolvedValue(null);
      mockTx.reservation.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(repo.holdSeat(holdParams)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('only checks HELD/CONFIRMED reservations for the requested seat', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 11 }]);
      mockTx.reservation.findFirst.mockResolvedValue(null);
      mockTx.reservation.create.mockResolvedValue({ id: 100 });

      await repo.holdSeat(holdParams);

      expect(mockTx.reservation.findFirst).toHaveBeenCalledWith({
        where: {
          screeningId: 3,
          seatId: 11,
          status: {
            in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
          },
        },
        select: { id: true },
      });
    });
  });

  describe('extendHold', () => {
    it('updates heldUntil by id', async () => {
      mockPrisma.write.reservation.update.mockResolvedValue({ id: 5 });
      const until = new Date('2026-07-02T12:30:00.000Z');

      await repo.extendHold(5, until);

      expect(mockPrisma.write.reservation.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { heldUntil: until },
      });
    });
  });

  describe('confirm', () => {
    it('sets status CONFIRMED and clears heldUntil', async () => {
      mockPrisma.write.reservation.update.mockResolvedValue({ id: 5 });

      await repo.confirm(5);

      expect(mockPrisma.write.reservation.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: ReservationStatus.CONFIRMED, heldUntil: null },
      });
    });
  });

  describe('findById', () => {
    it('looks the reservation up by id', async () => {
      mockPrisma.read.reservation.findUnique.mockResolvedValue({ id: 5 });

      await repo.findById(5);

      expect(mockPrisma.read.reservation.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
      });
    });
  });

  describe('setStatus', () => {
    it('updates the reservation status by id', async () => {
      mockPrisma.write.reservation.update.mockResolvedValue({ id: 5 });

      await repo.setStatus(5, ReservationStatus.CANCELLED);

      expect(mockPrisma.write.reservation.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: ReservationStatus.CANCELLED },
      });
    });
  });

  describe('findByUser', () => {
    it('lists the user reservations newest first with seat + screening + movie', async () => {
      mockPrisma.read.reservation.findMany.mockResolvedValue([]);

      await repo.findByUser(7);

      expect(mockPrisma.read.reservation.findMany).toHaveBeenCalledWith({
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
        { id: 100, userId: 7, screeningId: 3, seatId: 11 },
        { id: 101, userId: 9, screeningId: 3, seatId: 12 },
      ];
      mockPrisma.write.$queryRaw.mockResolvedValue(released);
      const now = new Date('2026-07-04T12:00:00.000Z');

      await expect(repo.releaseExpiredHolds(now)).resolves.toBe(released);
      expect(mockPrisma.write.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('resolves with an empty array when nothing has expired', async () => {
      mockPrisma.write.$queryRaw.mockResolvedValue([]);

      await expect(repo.releaseExpiredHolds(new Date())).resolves.toEqual([]);
    });
  });
});
