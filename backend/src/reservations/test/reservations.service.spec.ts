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
  RESERVATION_CONFIRMED,
  RESERVATION_CREATED,
} from '../events/reservation.events';

const mockReservationsRepo = {
  holdSeat: jest.fn(),
  extendHold: jest.fn(),
  confirm: jest.fn(),
  findById: jest.fn(),
  setStatus: jest.fn(),
  findByUser: jest.fn(),
  releaseExpiredHolds: jest.fn(),
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
    const dto = { screeningId: 3, seatId: 11 };

    it('holds the seat and returns the created reservation', async () => {
      const created = { id: 100, seatId: 11 };
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeat.mockResolvedValue(created);

      await expect(service.reserve(7, dto)).resolves.toBe(created);

      expect(mockReservationsRepo.holdSeat).toHaveBeenCalledWith({
        userId: 7,
        screeningId: 3,
        hallId: 2,
        seatId: 11,
        heldUntil: HELD_UNTIL,
      });
    });

    it('emits reservation.created with the screening id and seat id', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeat.mockResolvedValue({ id: 100, seatId: 11 });

      await service.reserve(7, dto);

      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CREATED, {
        screeningId: 3,
        seatIds: [11],
      });
    });

    it('throws 404 when the screening does not exist', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(null);

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.holdSeat).not.toHaveBeenCalled();
    });

    it('throws 404 when the screening is not SCHEDULED', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        status: ScreenStatus.CANCELLED,
      });

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReservationsRepo.holdSeat).not.toHaveBeenCalled();
    });

    it('throws 400 when the screening has already started', async () => {
      mockScreeningsRepo.findById.mockResolvedValue({
        ...screening,
        startTime: new Date('2026-07-02T11:59:59.000Z'), // before NOW
      });

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockReservationsRepo.holdSeat).not.toHaveBeenCalled();
    });

    it('does not emit when the hold fails', async () => {
      mockScreeningsRepo.findById.mockResolvedValue(screening);
      mockReservationsRepo.holdSeat.mockRejectedValue(new ConflictException());

      await expect(service.reserve(7, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });
  });

  describe('findOwned', () => {
    it('returns the reservation when owned by the caller', async () => {
      const reservation = { id: 100, userId: 7 };
      mockReservationsRepo.findById.mockResolvedValue(reservation);

      await expect(service.findOwned(7, 100)).resolves.toBe(reservation);
    });

    it('throws 404 when missing', async () => {
      mockReservationsRepo.findById.mockResolvedValue(null);

      await expect(service.findOwned(7, 100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when owned by someone else', async () => {
      mockReservationsRepo.findById.mockResolvedValue({ id: 100, userId: 99 });

      await expect(service.findOwned(7, 100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getById', () => {
    it('returns the reservation regardless of owner', async () => {
      const reservation = { id: 100, userId: 7 };
      mockReservationsRepo.findById.mockResolvedValue(reservation);

      await expect(service.getById(100)).resolves.toBe(reservation);
    });

    it('throws 404 when missing', async () => {
      mockReservationsRepo.findById.mockResolvedValue(null);

      await expect(service.getById(100)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('extendHold', () => {
    it('delegates to the repository', async () => {
      const until = new Date('2026-07-02T12:30:00.000Z');
      const updated = { id: 100, heldUntil: until };
      mockReservationsRepo.extendHold.mockResolvedValue(updated);

      await expect(service.extendHold(100, until)).resolves.toBe(updated);
      expect(mockReservationsRepo.extendHold).toHaveBeenCalledWith(100, until);
    });
  });

  describe('confirmPayment', () => {
    it('confirms the reservation and emits reservation.confirmed', async () => {
      const confirmed = { id: 100, screeningId: 3, seatId: 11 };
      mockReservationsRepo.confirm.mockResolvedValue(confirmed);

      await expect(service.confirmPayment(100)).resolves.toBe(confirmed);

      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CONFIRMED, {
        screeningId: 3,
        seatIds: [11],
      });
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

  describe('expireHolds', () => {
    it('does nothing and emits no event when nothing has expired', async () => {
      mockReservationsRepo.releaseExpiredHolds.mockResolvedValue([]);

      await service.expireHolds();

      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('emits one reservation.cancelled per screening, grouping seat ids', async () => {
      mockReservationsRepo.releaseExpiredHolds.mockResolvedValue([
        { id: 100, screeningId: 3, seatId: 11 },
        { id: 102, screeningId: 5, seatId: 20 },
        { id: 101, screeningId: 3, seatId: 12 },
      ]);

      await service.expireHolds();

      expect(mockEvents.emit).toHaveBeenCalledTimes(2);
      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CANCELLED, {
        screeningId: 3,
        seatIds: [11, 12],
      });
      expect(mockEvents.emit).toHaveBeenCalledWith(RESERVATION_CANCELLED, {
        screeningId: 5,
        seatIds: [20],
      });
    });

    it('passes the current time to the repository', async () => {
      mockReservationsRepo.releaseExpiredHolds.mockResolvedValue([]);

      await service.expireHolds();

      expect(mockReservationsRepo.releaseExpiredHolds).toHaveBeenCalledWith(
        NOW,
      );
    });
  });
});
