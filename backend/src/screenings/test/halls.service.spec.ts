import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { HallsService } from '../halls.service';
import { HallsRepository } from '../halls.repository';
import { ScreeningsCache } from '../screenings.cache';

const mockRepo = {
  createHallWithSeats: jest.fn(),
  findHallWithSeats: jest.fn(),
  listHalls: jest.fn(),
  deleteHall: jest.fn(),
  hasReservations: jest.fn(),
};

const mockScreeningsCache = {
  getHalls: jest.fn(),
  setHalls: jest.fn(),
  delHalls: jest.fn(),
};

const hallWithSeats = {
  id: 1,
  name: 'Hall 1',
  capacity: 2,
  seats: [
    { id: 1, hallId: 1, row: 'A', number: '1' },
    { id: 2, hallId: 1, row: 'A', number: '2' },
  ],
};

describe('HallsService', () => {
  let service: HallsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HallsService,
        { provide: HallsRepository, useValue: mockRepo },
        { provide: ScreeningsCache, useValue: mockScreeningsCache },
      ],
    }).compile();

    service = module.get<HallsService>(HallsService);
  });

  describe('createHall', () => {
    it('delegates to the repository, returns the hall, and invalidates hall list cache', async () => {
      mockRepo.createHallWithSeats.mockResolvedValue(hallWithSeats);
      const dto = { name: 'Hall 1', rows: 1, seatsPerRow: 2 };

      await expect(service.createHall(dto)).resolves.toBe(hallWithSeats);
      expect(mockRepo.createHallWithSeats).toHaveBeenCalledWith(dto);
      expect(mockScreeningsCache.delHalls).toHaveBeenCalled();
    });
  });

  describe('getHall', () => {
    it('returns the hall when it exists', async () => {
      mockRepo.findHallWithSeats.mockResolvedValue(hallWithSeats);

      await expect(service.getHall(1)).resolves.toBe(hallWithSeats);
    });

    it('throws NotFoundException for an unknown id', async () => {
      mockRepo.findHallWithSeats.mockResolvedValue(null);

      await expect(service.getHall(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listHalls', () => {
    it('returns cached halls without hitting the repository', async () => {
      const halls = [{ id: 1, name: 'A', capacity: 10 }, { id: 2, name: 'B', capacity: 20 }];
      mockScreeningsCache.getHalls.mockResolvedValue(halls);

      await expect(service.listHalls()).resolves.toBe(halls);
      expect(mockRepo.listHalls).not.toHaveBeenCalled();
    });

    it('queries the repository and populates cache on a miss', async () => {
      const halls = [{ id: 1 }, { id: 2 }];
      mockScreeningsCache.getHalls.mockResolvedValue(null);
      mockRepo.listHalls.mockResolvedValue(halls);

      await expect(service.listHalls()).resolves.toBe(halls);
      expect(mockRepo.listHalls).toHaveBeenCalled();
      expect(mockScreeningsCache.setHalls).toHaveBeenCalledWith(halls);
    });
  });

  describe('deleteHall', () => {
    it('deletes, invalidates hall list cache when the hall exists and has no reservations', async () => {
      mockRepo.findHallWithSeats.mockResolvedValue(hallWithSeats);
      mockRepo.hasReservations.mockResolvedValue(false);
      mockRepo.deleteHall.mockResolvedValue(hallWithSeats);

      await expect(service.deleteHall(1)).resolves.toBe(hallWithSeats);
      expect(mockRepo.deleteHall).toHaveBeenCalledWith(1);
      expect(mockScreeningsCache.delHalls).toHaveBeenCalled();
    });

    it('throws ConflictException (409) when the hall has reservations', async () => {
      mockRepo.findHallWithSeats.mockResolvedValue(hallWithSeats);
      mockRepo.hasReservations.mockResolvedValue(true);

      await expect(service.deleteHall(1)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockRepo.deleteHall).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (404) for an unknown id and checks nothing else', async () => {
      mockRepo.findHallWithSeats.mockResolvedValue(null);

      await expect(service.deleteHall(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockRepo.hasReservations).not.toHaveBeenCalled();
      expect(mockRepo.deleteHall).not.toHaveBeenCalled();
    });
  });
});
