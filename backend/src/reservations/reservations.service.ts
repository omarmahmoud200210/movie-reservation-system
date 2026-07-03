import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reservation, ReservationStatus, ScreenStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReservationsRepository } from './reservations.repository';
import { ScreeningsRepository } from '../screenings/screenings.repository';
import { CreateReservationDto } from './dto/create-reservation.dto';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CREATED,
} from './events/reservation.events';

const HOLD_MINUTES = 10;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly reservationsRepo: ReservationsRepository,
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Hold one or more seats for a screening, all-or-nothing. Creates HELD
   * reservations; confirmation happens later on payment.
   */
  async reserve(
    userId: number,
    dto: CreateReservationDto,
  ): Promise<Reservation[]> {
    const seatIds = [...new Set(dto.seatIds)];

    const screening = await this.screeningsRepo.findById(dto.screeningId);
    if (!screening || screening.status !== ScreenStatus.SCHEDULED) {
      throw new NotFoundException(`Screening ${dto.screeningId} not found`);
    }
    if (screening.startTime <= new Date()) {
      throw new BadRequestException('Screening has already started');
    }

    // DEFERRED(phase-6): the cron `expireHolds` job releases holds whose
    // heldUntil has passed and are still HELD.
    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60_000);

    const reservations = await this.reservationsRepo.holdSeats({
      userId,
      screeningId: dto.screeningId,
      hallId: screening.hallId,
      seatIds,
      heldUntil,
    });

    this.events.emit(RESERVATION_CREATED, {
      screeningId: dto.screeningId,
      seatIds: reservations.map((r) => r.seatId),
    });
    return reservations;
  }

  async cancel(userId: number, id: number): Promise<Reservation> {
    const reservation = await this.reservationsRepo.findById(id);
    // 404 (not 403) when it belongs to someone else, to avoid leaking existence.
    if (!reservation || reservation.userId !== userId) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    // DEFERRED(phase-9): cancelling a CONFIRMED booking must issue a refund via
    // the payment service; until then only HELD holds are cancellable here.
    if (reservation.status !== ReservationStatus.HELD) {
      throw new ConflictException('Only a held reservation can be cancelled');
    }

    const cancelled = await this.reservationsRepo.setStatus(
      id,
      ReservationStatus.CANCELLED,
    );
    this.events.emit(RESERVATION_CANCELLED, {
      screeningId: reservation.screeningId,
    });
    return cancelled;
  }

  listMine(userId: number): Promise<Reservation[]> {
    return this.reservationsRepo.findByUser(userId);
  }
}
