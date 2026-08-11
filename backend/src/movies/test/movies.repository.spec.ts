import { Test, TestingModule } from '@nestjs/testing';
import { MovieStatus, ScreenStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MoviesRepository } from '../movies.repository';

const mockPrisma = {
  read: {
    movie: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    reservation: {
      findFirst: jest.fn(),
    },
  },
  write: {
    movie: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
};

describe('MoviesRepository', () => {
  let repo: MoviesRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MoviesRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repo = module.get<MoviesRepository>(MoviesRepository);
  });

  it('create -> prisma.write.movie.create with the given data', async () => {
    const data = { name: 'Inception' } as never;
    mockPrisma.write.movie.create.mockResolvedValue({ id: 1 });

    await repo.create(data);

    expect(mockPrisma.write.movie.create).toHaveBeenCalledWith({ data });
  });

  it('update -> prisma.write.movie.update by id', async () => {
    const data = { name: 'New' } as never;
    mockPrisma.write.movie.update.mockResolvedValue({ id: 1 });

    await repo.update(1, data);

    expect(mockPrisma.write.movie.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data,
    });
  });

  it('findById -> prisma.read.movie.findUnique by id', async () => {
    mockPrisma.read.movie.findUnique.mockResolvedValue({ id: 1 });

    await repo.findById(1);

    expect(mockPrisma.read.movie.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  it('setStatus -> prisma.write.movie.update setting status', async () => {
    mockPrisma.write.movie.update.mockResolvedValue({ id: 1 });

    await repo.setStatus(1, MovieStatus.PUBLISHED);

    expect(mockPrisma.write.movie.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: MovieStatus.PUBLISHED },
    });
  });

  it('delete -> prisma.write.movie.delete by id', async () => {
    mockPrisma.write.movie.delete.mockResolvedValue({ id: 1 });

    await repo.delete(1);

    expect(mockPrisma.write.movie.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  it('listAll -> findMany ordered by createdAt desc', async () => {
    mockPrisma.read.movie.findMany.mockResolvedValue([]);

    await repo.listAll();

    expect(mockPrisma.read.movie.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });

  describe('hasReservations', () => {
    it('returns true when a reservation exists on a screening of the movie', async () => {
      mockPrisma.read.reservation.findFirst.mockResolvedValue({ id: 5 });

      await expect(repo.hasReservations(1)).resolves.toBe(true);
      expect(mockPrisma.read.reservation.findFirst).toHaveBeenCalledWith({
        where: { screen: { movieId: 1 } },
        select: { id: true },
      });
    });

    it('returns false when there are none', async () => {
      mockPrisma.read.reservation.findFirst.mockResolvedValue(null);

      await expect(repo.hasReservations(1)).resolves.toBe(false);
    });
  });

  it('findPublishedById -> findFirst by id + PUBLISHED status', async () => {
    mockPrisma.read.movie.findFirst.mockResolvedValue({ id: 1 });

    await repo.findPublishedById(1);

    expect(mockPrisma.read.movie.findFirst).toHaveBeenCalledWith({
      where: { id: 1, status: MovieStatus.PUBLISHED },
    });
  });

  describe('findPublishedForBrowse', () => {
    it('filters movies by PUBLISHED only, with the future-screening filter inside include', async () => {
      const now = new Date('2026-07-01T00:00:00.000Z');
      mockPrisma.read.movie.findMany.mockResolvedValue([]);

      await repo.findPublishedForBrowse(now);

      expect(mockPrisma.read.movie.findMany).toHaveBeenCalledWith({
        where: { status: MovieStatus.PUBLISHED },
        include: {
          screens: {
            where: { status: ScreenStatus.SCHEDULED, startTime: { gt: now } },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
