import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReservationStatus,
  Screening,
  ScreenStatus,
  SeatStatus,
} from '@prisma/client';
import { MoviesRepository } from '../movies/movies.repository';
import { MoviesCache } from '../movies/movies.cache';
import { HallsRepository } from './halls.repository';
import {
  ScreeningsRepository,
  ScreeningWithMovieHall,
} from './screenings.repository';
import { ScreeningsCache } from './screenings.cache';
import { CreateScreeningDto } from './dto/create-screening.dto';
import { UpdateScreeningDto } from './dto/update-screening.dto';

/** One seat in a screening's seat map, with reservation-derived status. */
export interface SeatMapEntry {
  seatId: number;
  row: string;
  number: string;
  status: SeatStatus;
}

/** Derived counts for a screening, used by the live seat-updates broadcast. */
export interface ScreeningSummary {
  screeningId: number;
  capacity: number;
  held: number;
  booked: number;
  available: number;
  reserved: number;
}

@Injectable()
export class ScreeningsService {
  constructor(
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly moviesRepo: MoviesRepository,
    private readonly hallsRepo: HallsRepository,
    private readonly screeningsCache: ScreeningsCache,
    private readonly moviesCache: MoviesCache,
  ) {}

  async createScreening(dto: CreateScreeningDto): Promise<Screening> {
    const movie = await this.moviesRepo.findById(dto.movieId);
    if (!movie) {
      throw new NotFoundException(`Movie ${dto.movieId} not found`);
    }
    const hall = await this.hallsRepo.findById(dto.hallId);
    if (!hall) {
      throw new NotFoundException(`Hall ${dto.hallId} not found`);
    }

    const start = new Date(dto.startTime);
    const end = this.computeEnd(start, movie.duration);
    await this.assertNoOverlap(dto.hallId, start, end);

    const screening = await this.screeningsRepo.create({
      movieId: dto.movieId,
      hallId: dto.hallId,
      startTime: start,
      price: dto.price,
    });
    // A new screening can move its movie from coming-soon to now-showing.
    await this.moviesCache.delLists();
    await this.screeningsCache.delMovieScreenings(dto.movieId);
    return screening;
  }

  async updateScreening(
    id: number,
    dto: UpdateScreeningDto,
  ): Promise<Screening> {
    const existing = await this.getExisting(id);

    const hallId = dto.hallId ?? existing.hallId;
    const start = dto.startTime ? new Date(dto.startTime) : existing.startTime;

    // Resolve the effective movie duration (only re-fetch if movie changed).
    let duration = existing.movie.duration;
    if (dto.movieId !== undefined && dto.movieId !== existing.movieId) {
      const movie = await this.moviesRepo.findById(dto.movieId);
      if (!movie) {
        throw new NotFoundException(`Movie ${dto.movieId} not found`);
      }
      duration = movie.duration;
    }
    if (dto.hallId !== undefined && dto.hallId !== existing.hallId) {
      const hall = await this.hallsRepo.findById(dto.hallId);
      if (!hall) {
        throw new NotFoundException(`Hall ${dto.hallId} not found`);
      }
    }

    const end = this.computeEnd(start, duration);
    await this.assertNoOverlap(hallId, start, end, id);

    const data: Prisma.ScreeningUncheckedUpdateInput = {};
    if (dto.movieId !== undefined) data.movieId = dto.movieId;
    if (dto.hallId !== undefined) data.hallId = dto.hallId;
    if (dto.startTime !== undefined) data.startTime = start;
    if (dto.price !== undefined) data.price = dto.price;

    const updated = await this.screeningsRepo.update(id, data);
    // A changed time can flip now-showing/coming-soon; a changed hall makes the
    // cached seat map wrong — invalidate both.
    await this.moviesCache.delLists();
    await this.screeningsCache.delSeatMap(id);
    await this.screeningsCache.delScreeningDetail(id);
    await this.screeningsCache.delMovieScreenings(existing.movieId);
    return updated;
  }

  async cancelScreening(id: number): Promise<Screening> {
    const existing = await this.getExisting(id);
    if (existing.status === ScreenStatus.CANCELLED) {
      throw new BadRequestException('Screening is already cancelled');
    }
    const cancelled = await this.screeningsRepo.setStatus(
      id,
      ScreenStatus.CANCELLED,
    );
    await this.moviesCache.delLists();
    await this.screeningsCache.delSeatMap(id);
    await this.screeningsCache.delScreeningDetail(id);
    await this.screeningsCache.delMovieScreenings(existing.movieId);
    return cancelled;
  }

  async deleteScreening(id: number): Promise<Screening> {
    const existing = await this.getExisting(id);
    if (await this.screeningsRepo.hasReservations(id)) {
      throw new ConflictException(
        'Cannot delete a screening with existing reservations; cancel it instead',
      );
    }
    const deleted = await this.screeningsRepo.delete(id);
    await this.moviesCache.delLists();
    await this.screeningsCache.delSeatMap(id);
    await this.screeningsCache.delScreeningDetail(id);
    await this.screeningsCache.delMovieScreenings(existing.movieId);
    return deleted;
  }

  /** Public screening detail (movie + hall). Cancelled/unknown → 404. */
  async getScreeningDetail(id: number): Promise<ScreeningWithMovieHall> {
    const cached = await this.screeningsCache.getScreeningDetail(id);
    if (cached) {
      if (cached.status === ScreenStatus.CANCELLED) {
        throw new NotFoundException(`Screening ${id} not found`);
      }
      return cached;
    }
    const screening = await this.screeningsRepo.findById(id);
    if (!screening || screening.status === ScreenStatus.CANCELLED) {
      throw new NotFoundException(`Screening ${id} not found`);
    }
    await this.screeningsCache.setScreeningDetail(screening);
    return screening;
  }

  /** Future scheduled screenings of a published movie (selection UI). */
  async getMovieScreenings(movieId: number) {
    const cached = await this.screeningsCache.getMovieScreenings(movieId);
    if (cached) {
      return cached;
    }
    const movie = await this.moviesRepo.findPublishedById(movieId);
    if (!movie) {
      throw new NotFoundException(`Movie ${movieId} not found`);
    }
    const screenings = await this.screeningsRepo.findFutureScheduledByMovie(
      movieId,
      new Date(),
    );
    await this.screeningsCache.setMovieScreenings(movieId, screenings);
    return screenings;
  }

  /**
   * Seat map for a screening: every hall seat with its reservation-derived
   * status (HELD → HELD, CONFIRMED → BOOKED, none/cancelled → AVAILABLE).
   */
  async getSeatMap(screeningId: number): Promise<SeatMapEntry[]> {
    const cached = await this.screeningsCache.getSeatMap(screeningId);
    if (cached) {
      return cached;
    }

    const screening = await this.screeningsRepo.findById(screeningId);
    if (!screening || screening.status === ScreenStatus.CANCELLED) {
      throw new NotFoundException(`Screening ${screeningId} not found`);
    }

    const [seats, reservations] = await Promise.all([
      this.screeningsRepo.findSeatsByHall(screening.hallId),
      this.screeningsRepo.findActiveReservations(screeningId),
    ]);

    const statusBySeat = new Map<number, ReservationStatus>();
    for (const r of reservations) {
      statusBySeat.set(r.seatId, r.status);
    }

    const seatMap = seats.map((seat) => ({
      seatId: seat.id,
      row: seat.row,
      number: seat.number,
      status: this.toSeatStatus(statusBySeat.get(seat.id)),
    }));
    await this.screeningsCache.setSeatMap(screeningId, seatMap);
    return seatMap;
  }

  /**
   * Derived seat counts for a screening — held/booked/available/reserved.
   * Reuses `getSeatMap`'s cache-aside read; no separate Redis structure, so
   * this can never drift from the seat map (both invalidate together).
   *
   * DEFERRED(phase-11): if load testing shows this recompute-on-broadcast is
   * a real hotspot, replace with an atomic Redis counter (HINCRBY on
   * reserve/cancel) instead of guessing now.
   */
  async getScreeningSummary(screeningId: number): Promise<ScreeningSummary> {
    const seatMap = await this.getSeatMap(screeningId);

    let held = 0;
    let booked = 0;
    for (const seat of seatMap) {
      if (seat.status === SeatStatus.HELD) held++;
      else if (seat.status === SeatStatus.BOOKED) booked++;
    }

    const capacity = seatMap.length;
    return {
      screeningId,
      capacity,
      held,
      booked,
      available: capacity - held - booked,
      reserved: held + booked,
    };
  }

  private toSeatStatus(reservationStatus?: ReservationStatus): SeatStatus {
    if (reservationStatus === ReservationStatus.HELD) return SeatStatus.HELD;
    if (reservationStatus === ReservationStatus.CONFIRMED) {
      return SeatStatus.BOOKED;
    }
    return SeatStatus.AVAILABLE;
  }

  private async assertNoOverlap(
    hallId: number,
    start: Date,
    end: Date,
    excludeId?: number,
  ): Promise<void> {
    const overlapping = await this.screeningsRepo.findOverlapping(
      hallId,
      start,
      end,
      excludeId,
    );
    if (overlapping.length > 0) {
      throw new ConflictException(
        'Hall already has a screening scheduled in this time range',
      );
    }
  }

  private computeEnd(start: Date, durationMinutes: number): Date {
    return new Date(start.getTime() + durationMinutes * 60_000);
  }

  private async getExisting(id: number): Promise<ScreeningWithMovieHall> {
    const screening = await this.screeningsRepo.findById(id);
    if (!screening) {
      throw new NotFoundException(`Screening ${id} not found`);
    }
    return screening;
  }
}
