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
  RESERVATION_CONFIRMED,
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
   * Hold one seat for a screening. Creates a HELD reservation; confirmation
   * happens later on payment.
   */
  async reserve(
    userId: number,
    dto: CreateReservationDto,
  ): Promise<Reservation> {
    const screening = await this.screeningsRepo.findById(dto.screeningId);
    if (!screening || screening.status !== ScreenStatus.SCHEDULED) {
      throw new NotFoundException(`Screening ${dto.screeningId} not found`);
    }
    if (screening.startTime <= new Date()) {
      throw new BadRequestException('Screening has already started');
    }

    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60_000);

    const reservation = await this.reservationsRepo.holdSeat({
      userId,
      screeningId: dto.screeningId,
      hallId: screening.hallId,
      seatId: dto.seatId,
      heldUntil,
    });

    this.events.emit(RESERVATION_CREATED, {
      screeningId: dto.screeningId,
      seatIds: [reservation.seatId],
    });
    return reservation;
  }

  /**
   * Release every HELD reservation whose 10-minute hold has expired. Groups
   * the released rows by screening and emits the existing
   * `reservation.cancelled` event per group.
   */
  async expireHolds(): Promise<void> {
    const released = await this.reservationsRepo.releaseExpiredHolds(
      new Date(),
    );
    if (released.length === 0) return;

    const byScreening = new Map<number, number[]>();
    for (const r of released) {
      const seatIds = byScreening.get(r.screeningId) ?? [];
      seatIds.push(r.seatId);
      byScreening.set(r.screeningId, seatIds);
    }

    for (const [screeningId, seatIds] of byScreening) {
      this.events.emit(RESERVATION_CANCELLED, { screeningId, seatIds });
    }
  }

  async cancel(userId: number, id: number): Promise<Reservation> {
    const reservation = await this.findOwned(userId, id);
    // Only HELD is cancellable here — cancelling a CONFIRMED (paid) booking
    // needs a refund first, handled by PaymentsService in a later phase.
    if (reservation.status !== ReservationStatus.HELD) {
      throw new ConflictException('Only a held reservation can be cancelled');
    }
    return this.finalizeCancel(reservation);
  }

  /** Sets CANCELLED and emits the shared cache/broadcast event. Also called by PaymentsService's refund flow. */
  async finalizeCancel(reservation: Reservation): Promise<Reservation> {
    const cancelled = await this.reservationsRepo.setStatus(
      reservation.id,
      ReservationStatus.CANCELLED,
    );
    this.events.emit(RESERVATION_CANCELLED, {
      screeningId: reservation.screeningId,
      seatIds: [reservation.seatId],
    });
    return cancelled;
  }

  /** 404 (not 403) when it belongs to someone else, to avoid leaking existence. */
  async findOwned(userId: number, id: number): Promise<Reservation> {
    const reservation = await this.getById(id);
    if (reservation.userId !== userId) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  /** No ownership check — for trusted system callers (webhook, cron). */
  async getById(id: number): Promise<Reservation> {
    const reservation = await this.reservationsRepo.findById(id);
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  extendHold(id: number, until: Date): Promise<Reservation> {
    return this.reservationsRepo.extendHold(id, until);
  }

  async confirmPayment(id: number): Promise<Reservation> {
    const reservation = await this.reservationsRepo.confirm(id);
    this.events.emit(RESERVATION_CONFIRMED, {
      screeningId: reservation.screeningId,
      seatIds: [reservation.seatId],
    });
    return reservation;
  }

  listMine(userId: number): Promise<Reservation[]> {
    return this.reservationsRepo.findByUser(userId);
  }
}
