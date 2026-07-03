import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReservationStatus, ScreenStatus } from '@prisma/client';
import { ReservationsService } from '../reservations.service';
import { ReservationsRepository } from '../reservations.repository';
import { ScreeningsRepository } from '../../screenings/screenings.repository';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CREATED,
} from '../events/reservation.events';

const mockReservationsRepo = {
  holdSeats: jest.fn(),
  findById: jest.fn(),
  setStatus: jest.fn(),
  findByUser: jest.fn(),
};
const mockScreeningsRepo = { findById: jest.fn() };
const mockEvents = { emit: jest.fn() };

const NOW = new Date('2026-07-02T12:00:00.000Z');
const HELD_UNTIL = new Date('2026-07-02T12:10:00.000Z'); // NOW + 10min

const screening = {
  id: 3,
  hallId: 2,
  movieId: 1,
  startTime: new Date('2026-07-02T18:00:00.000Z'), // future
  status: ScreenStatus.SCHEDULED,
  price: 50,
};

describe('ReservationsService', () => {
  let service: ReservationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: ReservationsRepository, useValue: mockReservationsRepo },
        { provide: ScreeningsRepository, useValue: mockScreeningsRepo },
        { provide: EventEmitter2, useValue: mockEvents },
      ],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
  });

  afterEach(() => jest.useRealTimers());

  describe('reserve', () => {
    const dto = { screeningId: 3, seatIds: [11, 12] };

    it('holds the seats and returns the created reservations', async () => {
      const created = [{ id: 100 }, { id: 101 }];
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeats.mockResolvedValue(created);

      await expect(service.reserve(7, dto)).resolves.toBe(created);

      expect(mockReservationsRepo.holdSeats).toHaveBeenCalledWith({
        userId: 7,
        screeningId: 3,
        hallId: 2,
        seatIds: [11, 12],
        heldUntil: HELD_UNTIL,
      });
    });

    it('dedups seat ids before holding', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeats.mockResolvedValue([]);

      await service.reserve(7, { screeningId: 3, seatIds: [11, 11, 12] });

      expect(mockReservationsRepo.holdSeats).toHaveBeenCalledWith(
        expect.objectContaining({ seatIds: [11, 12] }),
      );
    });

    it('emits reservation.created with the screening id and held seat ids', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeats.mockResolvedValue([
        { id: 100, seatId: 11 },
        { id: 101, seatId: 12 },
      ]);

      await service.reserve(7, dto);

      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CREATED, {
        screeningId: 3,
        seatIds: [11, 12],
      });
    });

    it('throws 404 when the screening does not exist', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.holdSeats).not.toHaveBeenCalled();
    });

    it('throws 404 when the screening is not SCHEDULED', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        status: ScreenStatus.CANCELLED,
      });

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.holdSeats).not.toHaveBeenCalled();
    });

    it('throws 400 when the screening has already started', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        startTime: new Date('2026-07-02T11:59:59.000Z'), // before NOW
      });

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockReservationsRepo.holdSeats).not.toHaveBeenCalled();
    });

    it('does not emit when the hold fails', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeats.mockRejectedValue(new ConflictException());

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const held = {
      id: 100,
      userId: 7,
      screeningId: 3,
      seatId: 11,
      status: ReservationStatus.HELD,
    };

    it('cancels a HELD reservation owned by the caller and emits', async () => {
      mockReservationsRepo.findById.mockResolvedValue(held);
      const cancelled = { ...held, status: ReservationStatus.CANCELLED };
      mockReservationsRepo.setStatus.mockResolvedValue(cancelled);

      await expect(service.cancel(7, 100)).resolves.toBe(cancelled);

      expect(mockReservationsRepo.setStatus).toHaveBeenCalledWith(
        100,
        ReservationStatus.CANCELLED,
      );
      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CANCELLED, {
        screeningId: 3,
        seatIds: [11],
      });
    });

    it('throws 404 when the reservation does not exist', async () => {
      mockReservationsRepo.findById.mockResolvedValue(null);

      await expect(service.cancel(7, 100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.setStatus).not.toHaveBeenCalled();
    });

    it('throws 404 when the reservation belongs to another user', async () => {
      mockReservationsRepo.findById.mockResolvedValue({ ...held, userId: 99 });

      await expect(service.cancel(7, 100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.setStatus).not.toHaveBeenCalled();
    });

    it('throws 409 when the reservation is not HELD', async () => {
      mockReservationsRepo.findById.mockResolvedValue({
        ...held,
        status: ReservationStatus.CONFIRMED,
      });

      await expect(service.cancel(7, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockReservationsRepo.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    it('returns the caller reservations from the repository', async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      mockReservationsRepo.findByUser.mockResolvedValue(rows);

      await expect(service.listMine(7)).resolves.toBe(rows);
      expect(mockReservationsRepo.findByUser).toHaveBeenCalledWith(7);
    });
  });
});
