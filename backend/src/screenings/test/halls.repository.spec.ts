import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { HallsRepository } from '../halls.repository';

// A transaction client exposing only what createHallWithSeats touches.
const tx = {
  hall: {
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  seat: {
    createMany: jest.fn(),
  },
};

const mockPrisma = {
  read: {
    hall: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    reservation: {
      findFirst: jest.fn(),
    },
  },
  write: {
    // Run the callback against `tx` so we can assert work happens on the
    // transaction client (atomic) rather than the root client.
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
    hall: {
      delete: jest.fn(),
    },
  },
};

/** Pull the seat array handed to `tx.seat.createMany`. */
function seatsFromCreateMany(): Array<{
  hallId: number;
  row: string;
  number: string;
}> {
  return tx.seat.createMany.mock.calls[0][0].data;
}

describe('HallsRepository', () => {
  let repo: HallsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HallsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repo = module.get<HallsRepository>(HallsRepository);
  });

  describe('createHallWithSeats', () => {
    beforeEach(() => {
      tx.hall.create.mockResolvedValue({ id: 1, name: 'Hall 1', capacity: 96 });
      tx.hall.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        name: 'Hall 1',
        capacity: 96,
        seats: [],
      });
    });

    it('derives capacity = rows * seatsPerRow', async () => {
      await repo.createHallWithSeats({ name: 'Hall 1', rows: 8, seatsPerRow: 12 });

      expect(tx.hall.create).toHaveBeenCalledWith({
        data: { name: 'Hall 1', capacity: 96 },
      });
    });

    it('generates one seat per grid cell (8 x 12 -> 96 seats)', async () => {
      await repo.createHallWithSeats({ name: 'Hall 1', rows: 8, seatsPerRow: 12 });

      expect(seatsFromCreateMany()).toHaveLength(96);
    });

    it('labels rows A..H for 8 rows', async () => {
      await repo.createHallWithSeats({ name: 'Hall 1', rows: 8, seatsPerRow: 12 });

      const rows = [...new Set(seatsFromCreateMany().map((s) => s.row))];
      expect(rows).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    });

    it('stores seat numbers as strings "1".."N"', async () => {
      await repo.createHallWithSeats({ name: 'Hall 1', rows: 1, seatsPerRow: 12 });

      const numbers = seatsFromCreateMany().map((s) => s.number);
      expect(numbers).toEqual([
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
      ]);
      numbers.forEach((n) => expect(typeof n).toBe('string'));
    });

    it('stamps every seat with the created hall id', async () => {
      tx.hall.create.mockResolvedValue({ id: 42, name: 'H', capacity: 1 });

      await repo.createHallWithSeats({ name: 'H', rows: 1, seatsPerRow: 1 });

      expect(seatsFromCreateMany()).toEqual([
        { hallId: 42, row: 'A', number: '1' },
      ]);
    });

    it('supports the minimal 1 x 1 hall', async () => {
      await repo.createHallWithSeats({ name: 'Tiny', rows: 1, seatsPerRow: 1 });

      expect(tx.hall.create).toHaveBeenCalledWith({
        data: { name: 'Tiny', capacity: 1 },
      });
      expect(seatsFromCreateMany()).toEqual([
        { hallId: 1, row: 'A', number: '1' },
      ]);
    });

    it('rolls past Z with bijective base-26 labels (row 27 -> "AA")', async () => {
      await repo.createHallWithSeats({ name: 'Big', rows: 27, seatsPerRow: 1 });

      const seats = seatsFromCreateMany();
      expect(seats[25].row).toBe('Z');
      expect(seats[26].row).toBe('AA');
    });

    it('does all writes inside a single transaction (atomic rollback)', async () => {
      await repo.createHallWithSeats({ name: 'Hall 1', rows: 2, seatsPerRow: 2 });

      expect(mockPrisma.write.$transaction).toHaveBeenCalledTimes(1);
      // Work runs on the tx client, never the root prisma client.
      expect(tx.hall.create).toHaveBeenCalled();
      expect(tx.seat.createMany).toHaveBeenCalled();
    });

    it('returns the hall re-read with its seats included', async () => {
      const hall = await repo.createHallWithSeats({
        name: 'Hall 1',
        rows: 2,
        seatsPerRow: 2,
      });

      expect(tx.hall.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { seats: { orderBy: [{ row: 'asc' }, { id: 'asc' }] } },
      });
      expect(hall).toHaveProperty('seats');
    });

    // NOTE: seat-position uniqueness is enforced by the schema
    // @@unique([hallId,row,number]) constraint, which a mocked-Prisma unit
    // test cannot exercise. The A..H distinct-rows assertion above is the
    // unit-level proxy; true uniqueness needs an e2e test against Postgres.
  });

  describe('findHallWithSeats', () => {
    it('queries by id with seats included', async () => {
      mockPrisma.read.hall.findUnique.mockResolvedValue({ id: 1, seats: [] });

      await repo.findHallWithSeats(1);

      expect(mockPrisma.read.hall.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { seats: { orderBy: [{ row: 'asc' }, { id: 'asc' }] } },
      });
    });
  });

  describe('listHalls', () => {
    it('lists halls ordered by id asc', async () => {
      mockPrisma.read.hall.findMany.mockResolvedValue([]);

      await repo.listHalls();

      expect(mockPrisma.read.hall.findMany).toHaveBeenCalledWith({
        orderBy: { id: 'asc' },
      });
    });
  });

  describe('deleteHall', () => {
    it('deletes by id', async () => {
      mockPrisma.write.hall.delete.mockResolvedValue({ id: 1 });

      await repo.deleteHall(1);

      expect(mockPrisma.write.hall.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  describe('hasReservations', () => {
    it('finds a reservation across the hall screenings and returns true when one exists', async () => {
      mockPrisma.read.reservation.findFirst.mockResolvedValue({ id: 3 });

      await expect(repo.hasReservations(7)).resolves.toBe(true);
      expect(mockPrisma.read.reservation.findFirst).toHaveBeenCalledWith({
        where: { screen: { hallId: 7 } },
        select: { id: true },
      });
    });

    it('returns false when there are none', async () => {
      mockPrisma.read.reservation.findFirst.mockResolvedValue(null);

      await expect(repo.hasReservations(7)).resolves.toBe(false);
    });
  });
});
