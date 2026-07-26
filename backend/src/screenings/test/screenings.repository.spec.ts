import { Test, TestingModule } from '@nestjs/testing';
import { ReservationStatus, ScreenStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreeningsRepository } from '../screenings.repository';

const mockPrisma = {
  read: {
    screening: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    seat: {
      findMany: jest.fn(),
    },
    reservation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
  write: {
    screening: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
};

/** Build a candidate screening as findMany would return it (movie.duration only). */
function candidate(startISO: string, durationMin: number, id = 1) {
  return {
    id,
    startTime: new Date(startISO),
    movie: { duration: durationMin },
  };
}

describe('ScreeningsRepository', () => {
  let repo: ScreeningsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreeningsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repo = module.get<ScreeningsRepository>(ScreeningsRepository);
  });

  describe('plain query shapes', () => {
    it('create -> prisma.write.screening.create with data', async () => {
      const data = { movieId: 1, hallId: 1, startTime: new Date(), price: 10 };
      mockPrisma.write.screening.create.mockResolvedValue({ id: 1 });

      await repo.create(data);

      expect(mockPrisma.write.screening.create).toHaveBeenCalledWith({ data });
    });

    it('update -> prisma.write.screening.update by id', async () => {
      const data = { price: 20 };
      mockPrisma.write.screening.update.mockResolvedValue({ id: 1 });

      await repo.update(1, data);

      expect(mockPrisma.write.screening.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data,
      });
    });

    it('findById -> findUnique including movie + hall', async () => {
      mockPrisma.read.screening.findUnique.mockResolvedValue({ id: 1 });

      await repo.findById(1);

      expect(mockPrisma.read.screening.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { movie: true, hall: true },
      });
    });

    it('setStatus -> write.screening.update setting status', async () => {
      mockPrisma.write.screening.update.mockResolvedValue({ id: 1 });

      await repo.setStatus(1, ScreenStatus.CANCELLED);

      expect(mockPrisma.write.screening.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: ScreenStatus.CANCELLED },
      });
    });

    it('delete -> prisma.write.screening.delete by id', async () => {
      mockPrisma.write.screening.delete.mockResolvedValue({ id: 1 });

      await repo.delete(1);

      expect(mockPrisma.write.screening.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('hasReservations -> read.reservation.findFirst, true when one exists', async () => {
      mockPrisma.read.reservation.findFirst.mockResolvedValue({ id: 5 });

      await expect(repo.hasReservations(1)).resolves.toBe(true);
      expect(mockPrisma.read.reservation.findFirst).toHaveBeenCalledWith({
        where: { screeningId: 1 },
        select: { id: true },
      });
    });

    it('hasReservations -> false when none', async () => {
      mockPrisma.read.reservation.findFirst.mockResolvedValue(null);

      await expect(repo.hasReservations(1)).resolves.toBe(false);
    });
  });

  describe('findOverlapping', () => {
    // Query window: 18:00 -> 20:00 on a fixed day.
    const start = new Date('2026-07-01T18:00:00.000Z');
    const end = new Date('2026-07-01T20:00:00.000Z');

    it('filters by hall + non-cancelled, no id filter without excludeId', async () => {
      mockPrisma.read.screening.findMany.mockResolvedValue([]);

      await repo.findOverlapping(3, start, end);

      expect(mockPrisma.read.screening.findMany).toHaveBeenCalledWith({
        where: { hallId: 3, status: { not: ScreenStatus.CANCELLED } },
        include: { movie: { select: { duration: true } } },
      });
    });

    it('adds id: { not: excludeId } when editing a screening', async () => {
      mockPrisma.read.screening.findMany.mockResolvedValue([]);

      await repo.findOverlapping(3, start, end, 42);

      expect(mockPrisma.read.screening.findMany).toHaveBeenCalledWith({
        where: {
          hallId: 3,
          status: { not: ScreenStatus.CANCELLED },
          id: { not: 42 },
        },
        include: { movie: { select: { duration: true } } },
      });
    });

    it('returns a candidate whose interval intersects the window', async () => {
      // 19:00 + 90min -> [19:00, 20:30) intersects [18:00, 20:00)
      mockPrisma.read.screening.findMany.mockResolvedValue([
        candidate('2026-07-01T19:00:00.000Z', 90, 7),
      ]);

      const result = await repo.findOverlapping(3, start, end);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(7);
    });

    it('excludes a candidate ending before the window starts', async () => {
      // 16:00 + 90min -> [16:00, 17:30), ends before 18:00
      mockPrisma.read.screening.findMany.mockResolvedValue([
        candidate('2026-07-01T16:00:00.000Z', 90),
      ]);

      await expect(repo.findOverlapping(3, start, end)).resolves.toEqual([]);
    });

    it('excludes a candidate starting after the window ends', async () => {
      // 20:30 + 60min -> starts after 20:00
      mockPrisma.read.screening.findMany.mockResolvedValue([
        candidate('2026-07-01T20:30:00.000Z', 60),
      ]);

      await expect(repo.findOverlapping(3, start, end)).resolves.toEqual([]);
    });

    it('treats touching intervals as non-overlapping (half-open)', async () => {
      // ends exactly at 18:00: 16:00 + 120min -> [16:00, 18:00)
      // starts exactly at 20:00: 20:00 + 60min -> [20:00, 21:00)
      mockPrisma.read.screening.findMany.mockResolvedValue([
        candidate('2026-07-01T16:00:00.000Z', 120, 1),
        candidate('2026-07-01T20:00:00.000Z', 60, 2),
      ]);

      await expect(repo.findOverlapping(3, start, end)).resolves.toEqual([]);
    });

    it('uses duration (minutes -> ms) to compute candidate end', async () => {
      // 17:30 + 120min -> [17:30, 19:30) intersects the window only because
      // 120 minutes is applied as minutes, not seconds.
      mockPrisma.read.screening.findMany.mockResolvedValue([
        candidate('2026-07-01T17:30:00.000Z', 120, 9),
      ]);

      const result = await repo.findOverlapping(3, start, end);

      expect(result.map((s) => s.id)).toEqual([9]);
    });
  });

  describe('findFutureScheduledByMovie', () => {
    it('queries future SCHEDULED screenings of the movie with hall, ordered by startTime', async () => {
      const now = new Date('2026-07-01T00:00:00.000Z');
      mockPrisma.read.screening.findMany.mockResolvedValue([]);

      await repo.findFutureScheduledByMovie(7, now);

      expect(mockPrisma.read.screening.findMany).toHaveBeenCalledWith({
        where: {
          movieId: 7,
          status: ScreenStatus.SCHEDULED,
          startTime: { gt: now },
        },
        select: {
          id: true,
          startTime: true,
          price: true,
          hall: { select: { id: true, name: true, capacity: true } },
        },
        orderBy: { startTime: 'asc' },
      });
    });
  });

  describe('findSeatsByHall', () => {
    it('lists hall seats ordered by row then id', async () => {
      mockPrisma.read.seat.findMany.mockResolvedValue([]);

      await repo.findSeatsByHall(2);

      expect(mockPrisma.read.seat.findMany).toHaveBeenCalledWith({
        where: { hallId: 2 },
        orderBy: [{ row: 'asc' }, { id: 'asc' }],
      });
    });
  });

  describe('findActiveReservations', () => {
    it('selects HELD/CONFIRMED reservations (excluding CANCELLED) keyed by seat', async () => {
      mockPrisma.read.reservation.findMany.mockResolvedValue([]);

      await repo.findActiveReservations(10);

      expect(mockPrisma.read.reservation.findMany).toHaveBeenCalledWith({
        where: {
          screeningId: 10,
          status: {
            in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
          },
        },
        select: { seatId: true, status: true },
      });
    });
  });
});
