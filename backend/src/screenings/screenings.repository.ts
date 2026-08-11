import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ReservationStatus,
  Screening,
  ScreenStatus,
  Seat,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ScreeningWithMovieHall = Prisma.ScreeningGetPayload<{
  include: { movie: true; hall: true };
}>;

@Injectable()
export class ScreeningsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Status defaults to SCHEDULED via the schema default. */
  create(data: Prisma.ScreeningUncheckedCreateInput): Promise<Screening> {
    return this.prisma.screening.create({ data });
  }

  update(
    id: number,
    data: Prisma.ScreeningUncheckedUpdateInput,
  ): Promise<Screening> {
    return this.prisma.screening.update({ where: { id }, data });
  }

  findById(id: number): Promise<ScreeningWithMovieHall | null> {
    return this.prisma.screening.findUnique({
      where: { id },
      include: { movie: true, hall: true },
    });
  }

  setStatus(id: number, status: ScreenStatus): Promise<Screening> {
    return this.prisma.screening.update({
      where: { id },
      data: { status },
    });
  }

  delete(id: number): Promise<Screening> {
    return this.prisma.screening.delete({ where: { id } });
  }

  async hasReservations(screeningId: number): Promise<boolean> {
    const reservation = await this.prisma.reservation.findFirst({
      where: { screeningId },
      select: { id: true },
    });
    return reservation !== null;
  }

  /**
   * Non-cancelled screenings in the hall whose interval
   * `[startTime, startTime + movie.duration)` intersects `[start, end)`.
   *
   * Each existing screening's end depends on its own movie's duration, which
   * can't be expressed in a SQL predicate, so we fetch the hall's non-cancelled
   * screenings (with movie duration) and apply the interval test in memory.
   * `excludeId` drops the screening being edited from its own overlap check.
   */
  async findOverlapping(
    hallId: number,
    start: Date,
    end: Date,
    excludeId?: number,
  ): Promise<Screening[]> {
    const candidates = await this.prisma.screening.findMany({
      where: {
        hallId,
        status: { not: ScreenStatus.CANCELLED },
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
      },
      include: { movie: { select: { duration: true } } },
    });

    const startMs = start.getTime();
    const endMs = end.getTime();

    return candidates.filter((s) => {
      const sStart = s.startTime.getTime();
      const sEnd = sStart + s.movie.duration * 60_000;
      // Half-open intervals overlap iff each starts before the other ends.
      return sStart < endMs && sEnd > startMs;
    });
  }

  /**
   * Future SCHEDULED screenings of a movie, with their hall, for the
   * selection UI. Ordered by start time.
   */
  findFutureScheduledByMovie(movieId: number, now: Date) {
    return this.prisma.screening.findMany({
      where: {
        movieId,
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
  }

  /** Every seat of a hall, ordered for a stable seat-map layout. */
  findSeatsByHall(hallId: number): Promise<Seat[]> {
    return this.prisma.seat.findMany({
      where: { hallId },
      orderBy: [{ row: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Active (HELD / CONFIRMED) reservations for a screening, keyed by seat.
   * CANCELLED reservations are excluded so their seats read as AVAILABLE.
   */
  findActiveReservations(
    screeningId: number,
  ): Promise<{ seatId: number; status: ReservationStatus }[]> {
    return this.prisma.reservation.findMany({
      where: {
        screeningId,
        status: {
          in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
        },
      },
      select: { seatId: true, status: true },
    });
  }
}
