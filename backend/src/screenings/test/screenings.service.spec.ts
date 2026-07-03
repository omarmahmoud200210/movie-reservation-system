import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ReservationStatus,
  ScreenStatus,
  SeatStatus,
} from '@prisma/client';
import { ScreeningsService } from '../screenings.service';
import { ScreeningsRepository } from '../screenings.repository';
import { ScreeningsCache } from '../screenings.cache';
import { HallsRepository } from '../halls.repository';
import { MoviesRepository } from '../../movies/movies.repository';
import { MoviesCache } from '../../movies/movies.cache';

const mockScreeningsRepo = {
  create: jest.fn(),
  update: jest.fn(),
  findById: jest.fn(),
  setStatus: jest.fn(),
  delete: jest.fn(),
  hasReservations: jest.fn(),
  findOverlapping: jest.fn(),
  findFutureScheduledByMovie: jest.fn(),
  findSeatsByHall: jest.fn(),
  findActiveReservations: jest.fn(),
};
const mockMoviesRepo = { findById: jest.fn(), findPublishedById: jest.fn() };
const mockHallsRepo = { findById: jest.fn() };
const mockScreeningsCache = {
  getSeatMap: jest.fn(),
  setSeatMap: jest.fn(),
  delSeatMap: jest.fn(),
};
const mockMoviesCache = { delLists: jest.fn() };

const START_ISO = '2026-07-01T18:00:00.000Z';
const START = new Date(START_ISO);
const END_120 = new Date('2026-07-01T20:00:00.000Z'); // START + 120 min

const movie = { id: 1, duration: 120 };
const hall = { id: 2, name: 'Hall 2', capacity: 10 };

const existing = {
  id: 10,
  movieId: 1,
  hallId: 2,
  startTime: START,
  status: ScreenStatus.SCHEDULED,
  price: 50,
  movie,
  hall,
};

describe('ScreeningsService', () => {
  let service: ScreeningsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreeningsService,
        { provide: ScreeningsRepository, useValue: mockScreeningsRepo },
        { provide: MoviesRepository, useValue: mockMoviesRepo },
        { provide: HallsRepository, useValue: mockHallsRepo },
        { provide: ScreeningsCache, useValue: mockScreeningsCache },
        { provide: MoviesCache, useValue: mockMoviesCache },
      ],
    }).compile();

    service = module.get<ScreeningsService>(ScreeningsService);
  });

  describe('createScreening', () => {
    const dto = { movieId: 1, hallId: 2, startTime: START_ISO, price: 50 };

    it('creates a SCHEDULED screening when there is no overlap', async () => {
      mockMoviesRepo.findById.mockResolvedValue(movie);
      mockHallsRepo.findById.mockResolvedValue(hall);
      mockScreeningsRepo.findOverlapping.mockResolvedValue([]);
      mockScreeningsRepo.create.mockResolvedValue({ id: 11 });

      await service.createScreening(dto);

      expect(mockScreeningsRepo.create).toHaveBeenCalledWith({
        movieId: 1,
        hallId: 2,
        startTime: START,
        price: 50,
      });
      // startTime is converted to a Date, not passed as a string.
      const arg = mockScreeningsRepo.create.mock.calls[0][0];
      expect(arg.startTime).toBeInstanceOf(Date);
    });

    it('computes the overlap window as start + movie.duration with no excludeId', async () => {
      mockMoviesRepo.findById.mockResolvedValue(movie);
      mockHallsRepo.findById.mockResolvedValue(hall);
      mockScreeningsRepo.findOverlapping.mockResolvedValue([]);
      mockScreeningsRepo.create.mockResolvedValue({ id: 11 });

      await service.createScreening(dto);

      expect(mockScreeningsRepo.findOverlapping).toHaveBeenCalledWith(
        2,
        START,
        END_120,
        undefined,
      );
    });

    it('throws 404 when the movie does not exist', async () => {
      mockMoviesRepo.findById.mockResolvedValue(null);

      await expect(service.createScreening(dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockHallsRepo.findById).not.toHaveBeenCalled();
      expect(mockScreeningsRepo.create).not.toHaveBeenCalled();
    });

    it('throws 404 when the hall does not exist', async () => {
      mockMoviesRepo.findById.mockResolvedValue(movie);
      mockHallsRepo.findById.mockResolvedValue(null);

      await expect(service.createScreening(dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockScreeningsRepo.create).not.toHaveBeenCalled();
    });

    it('throws 409 when the hall is already booked in that window', async () => {
      mockMoviesRepo.findById.mockResolvedValue(movie);
      mockHallsRepo.findById.mockResolvedValue(hall);
      mockScreeningsRepo.findOverlapping.mockResolvedValue([{ id: 99 }]);

      await expect(service.createScreening(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockScreeningsRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateScreening', () => {
    it('throws 404 for an unknown id', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateScreening(99, { price: 80 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-checks overlap (excluding self) and updates only provided fields', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.findOverlapping.mockResolvedValue([]);
      mockScreeningsRepo.update.mockResolvedValue({ ...existing, price: 80 });

      await service.updateScreening(10, { price: 80 });

      // existing movie duration + hall + startTime reused; excludeId = 10
      expect(mockScreeningsRepo.findOverlapping).toHaveBeenCalledWith(
        2,
        START,
        END_120,
        10,
      );
      // only the provided key is written (no undefined smearing)
      expect(mockScreeningsRepo.update).toHaveBeenCalledWith(10, { price: 80 });
    });

    it('re-fetches the new movie for duration when movieId changes', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockMoviesRepo.findById.mockResolvedValue({ id: 5, duration: 90 });
      mockScreeningsRepo.findOverlapping.mockResolvedValue([]);
      mockScreeningsRepo.update.mockResolvedValue(existing);

      await service.updateScreening(10, { movieId: 5 });

      expect(mockMoviesRepo.findById).toHaveBeenCalledWith(5);
      // window now start + 90 min -> 19:30
      expect(mockScreeningsRepo.findOverlapping).toHaveBeenCalledWith(
        2,
        START,
        new Date('2026-07-01T19:30:00.000Z'),
        10,
      );
    });

    it('throws 404 when the new movieId does not exist', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockMoviesRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateScreening(10, { movieId: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockScreeningsRepo.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the new hallId does not exist', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockHallsRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateScreening(10, { hallId: 7 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockScreeningsRepo.update).not.toHaveBeenCalled();
    });

    it('converts a changed startTime to a Date for both overlap and update', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.findOverlapping.mockResolvedValue([]);
      mockScreeningsRepo.update.mockResolvedValue(existing);
      const newStartISO = '2026-07-01T21:00:00.000Z';

      await service.updateScreening(10, { startTime: newStartISO });

      const overlapArgs = mockScreeningsRepo.findOverlapping.mock.calls[0];
      expect(overlapArgs[1]).toEqual(new Date(newStartISO));
      const updateData = mockScreeningsRepo.update.mock.calls[0][1];
      expect(updateData.startTime).toBeInstanceOf(Date);
      expect(updateData.startTime).toEqual(new Date(newStartISO));
    });

    it('throws 409 when the edit overlaps another screening', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.findOverlapping.mockResolvedValue([{ id: 99 }]);

      await expect(
        service.updateScreening(10, { price: 80 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockScreeningsRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelScreening', () => {
    it('flips a SCHEDULED screening to CANCELLED', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.setStatus.mockResolvedValue({
        ...existing,
        status: ScreenStatus.CANCELLED,
      });

      await service.cancelScreening(10);

      expect(mockScreeningsRepo.setStatus).toHaveBeenCalledWith(
        10,
        ScreenStatus.CANCELLED,
      );
    });

    it('rejects cancelling an already-CANCELLED screening with 400', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...existing,
        status: ScreenStatus.CANCELLED,
      });

      await expect(service.cancelScreening(10)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockScreeningsRepo.setStatus).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown id', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.cancelScreening(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deleteScreening', () => {
    it('deletes when there are no reservations', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.hasReservations.mockResolvedValue(false);
      mockScreeningsRepo.delete.mockResolvedValue(existing);

      await service.deleteScreening(10);

      expect(mockScreeningsRepo.delete).toHaveBeenCalledWith(10);
    });

    it('throws 409 when the screening has reservations', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.hasReservations.mockResolvedValue(true);

      await expect(service.deleteScreening(10)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockScreeningsRepo.delete).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown id and checks nothing else', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.deleteScreening(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockScreeningsRepo.hasReservations).not.toHaveBeenCalled();
      expect(mockScreeningsRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('getScreeningDetail', () => {
    it('returns a scheduled screening with movie + hall', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);

      await expect(service.getScreeningDetail(10)).resolves.toBe(existing);
    });

    it('throws 404 for a cancelled screening', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...existing,
        status: ScreenStatus.CANCELLED,
      });

      await expect(service.getScreeningDetail(10)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 for an unknown id', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.getScreeningDetail(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getMovieScreenings', () => {
    it('returns future scheduled screenings for a published movie', async () => {
      const screenings = [{ id: 1 }, { id: 2 }];
      mockMoviesRepo.findPublishedById.mockResolvedValue(movie);
      mockScreeningsRepo.findFutureScheduledByMovie.mockResolvedValue(
        screenings,
      );

      await expect(service.getMovieScreenings(1)).resolves.toBe(screenings);
      const arg = mockScreeningsRepo.findFutureScheduledByMovie.mock.calls[0];
      expect(arg[0]).toBe(1);
      expect(arg[1]).toBeInstanceOf(Date);
    });

    it('throws 404 for a draft/unknown movie and never queries screenings', async () => {
      mockMoviesRepo.findPublishedById.mockResolvedValue(null);

      await expect(service.getMovieScreenings(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(
        mockScreeningsRepo.findFutureScheduledByMovie,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getSeatMap', () => {
    const seats = [
      { id: 100, hallId: 2, row: 'A', number: '1' },
      { id: 101, hallId: 2, row: 'A', number: '2' },
      { id: 102, hallId: 2, row: 'A', number: '3' },
    ];

    beforeEach(() => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.findSeatsByHall.mockResolvedValue(seats);
    });

    it('maps HELD -> HELD, CONFIRMED -> BOOKED, none -> AVAILABLE', async () => {
      mockScreeningsRepo.findActiveReservations.mockResolvedValue([
        { seatId: 100, status: ReservationStatus.HELD },
        { seatId: 101, status: ReservationStatus.CONFIRMED },
        // seat 102 has no reservation
      ]);

      const map = await service.getSeatMap(10);

      expect(map).toEqual([
        { seatId: 100, row: 'A', number: '1', status: SeatStatus.HELD },
        { seatId: 101, row: 'A', number: '2', status: SeatStatus.BOOKED },
        { seatId: 102, row: 'A', number: '3', status: SeatStatus.AVAILABLE },
      ]);
    });

    it('returns every hall seat exactly once in seat order', async () => {
      mockScreeningsRepo.findActiveReservations.mockResolvedValue([]);

      const map = await service.getSeatMap(10);

      expect(map.map((s) => s.seatId)).toEqual([100, 101, 102]);
    });

    it('fetches seats for the screening hall and reservations for the screening', async () => {
      mockScreeningsRepo.findActiveReservations.mockResolvedValue([]);

      await service.getSeatMap(10);

      expect(mockScreeningsRepo.findSeatsByHall).toHaveBeenCalledWith(2);
      expect(mockScreeningsRepo.findActiveReservations).toHaveBeenCalledWith(10);
    });

    it('throws 404 for a cancelled screening without fetching seats', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...existing,
        status: ScreenStatus.CANCELLED,
      });

      await expect(service.getSeatMap(10)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockScreeningsRepo.findSeatsByHall).not.toHaveBeenCalled();
    });
  });

  describe('getScreeningSummary', () => {
    beforeEach(() => {
      mockScreeningsCache.getSeatMap.mockResolvedValue(null);
    });

    it('derives capacity/held/booked/available/reserved from the seat map', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(existing);
      mockScreeningsRepo.findSeatsByHall.mockResolvedValue([
        { id: 100, hallId: 2, row: 'A', number: '1' },
        { id: 101, hallId: 2, row: 'A', number: '2' },
        { id: 102, hallId: 2, row: 'A', number: '3' },
        { id: 103, hallId: 2, row: 'A', number: '4' },
      ]);
      mockScreeningsRepo.findActiveReservations.mockResolvedValue([
        { seatId: 100, status: ReservationStatus.HELD },
        { seatId: 101, status: ReservationStatus.CONFIRMED },
      ]);

      await expect(service.getScreeningSummary(10)).resolves.toEqual({
        screeningId: 10,
        capacity: 4,
        held: 1,
        booked: 1,
        available: 2,
        reserved: 2,
      });
    });

    it('reads from the warm seat-map cache without hitting the DB', async () => {
      mockScreeningsCache.getSeatMap.mockResolvedValue([
        { seatId: 1, row: 'A', number: '1', status: SeatStatus.AVAILABLE },
      ]);

      await expect(service.getScreeningSummary(10)).resolves.toEqual({
        screeningId: 10,
        capacity: 1,
        held: 0,
        booked: 0,
        available: 1,
        reserved: 0,
      });
      expect(mockScreeningsRepo.findById).not.toHaveBeenCalled();
    });

    it('throws 404 for a cancelled/unknown screening (propagated from getSeatMap)', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.getScreeningSummary(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('caching', () => {
    describe('getSeatMap (cache-aside)', () => {
      it('serves from cache on a hit without querying the DB', async () => {
        const cached = [
          { seatId: 1, row: 'A', number: '1', status: SeatStatus.AVAILABLE },
        ];
        mockScreeningsCache.getSeatMap.mockResolvedValue(cached);

        await expect(service.getSeatMap(10)).resolves.toBe(cached);
        expect(mockScreeningsRepo.findById).not.toHaveBeenCalled();
        expect(mockScreeningsRepo.findSeatsByHall).not.toHaveBeenCalled();
      });

      it('populates the cache on a miss', async () => {
        mockScreeningsCache.getSeatMap.mockResolvedValue(null);
        mockScreeningsRepo.findById.mockResolvedValue(existing);
        mockScreeningsRepo.findSeatsByHall.mockResolvedValue([]);
        mockScreeningsRepo.findActiveReservations.mockResolvedValue([]);

        await service.getSeatMap(10);

        expect(mockScreeningsCache.setSeatMap).toHaveBeenCalledWith(10, []);
      });
    });

    describe('write invalidation', () => {
      const dto = { movieId: 1, hallId: 2, startTime: START_ISO, price: 50 };

      it('createScreening clears the browse lists', async () => {
        mockMoviesRepo.findById.mockResolvedValue(movie);
        mockHallsRepo.findById.mockResolvedValue(hall);
        mockScreeningsRepo.findOverlapping.mockResolvedValue([]);
        mockScreeningsRepo.create.mockResolvedValue({ id: 11 });

        await service.createScreening(dto);

        expect(mockMoviesCache.delLists).toHaveBeenCalled();
      });

      it('updateScreening clears the browse lists and the seat map', async () => {
        mockScreeningsRepo.findById.mockResolvedValue(existing);
        mockScreeningsRepo.findOverlapping.mockResolvedValue([]);
        mockScreeningsRepo.update.mockResolvedValue(existing);

        await service.updateScreening(10, { price: 80 });

        expect(mockMoviesCache.delLists).toHaveBeenCalled();
        expect(mockScreeningsCache.delSeatMap).toHaveBeenCalledWith(10);
      });

      it('cancelScreening clears the browse lists and the seat map', async () => {
        mockScreeningsRepo.findById.mockResolvedValue(existing);
        mockScreeningsRepo.setStatus.mockResolvedValue({
          ...existing,
          status: ScreenStatus.CANCELLED,
        });

        await service.cancelScreening(10);

        expect(mockMoviesCache.delLists).toHaveBeenCalled();
        expect(mockScreeningsCache.delSeatMap).toHaveBeenCalledWith(10);
      });

      it('deleteScreening clears the browse lists and the seat map', async () => {
        mockScreeningsRepo.findById.mockResolvedValue(existing);
        mockScreeningsRepo.hasReservations.mockResolvedValue(false);
        mockScreeningsRepo.delete.mockResolvedValue(existing);

        await service.deleteScreening(10);

        expect(mockMoviesCache.delLists).toHaveBeenCalled();
        expect(mockScreeningsCache.delSeatMap).toHaveBeenCalledWith(10);
      });
    });
  });
});
