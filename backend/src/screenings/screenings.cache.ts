import { Injectable, Logger } from '@nestjs/common';
import { Hall, Prisma } from '@prisma/client';
import RedisCache from '../redis/redis.cache';
import { ScreeningWithMovieHall } from './screenings.repository';
import { SeatMapEntry } from './screenings.service';

type FutureScreening = Prisma.ScreeningGetPayload<{
  select: {
    id: true;
    startTime: true;
    price: true;
    hall: { select: { id: true; name: true; capacity: true } };
  };
}>;

const seatMapKey = (screeningId: number) => `seat_map:screening:${screeningId}`;
const SEAT_MAP_TTL_SECONDS = 300; // 5m — seat status changes as seats are held

const screeningDetailKey = (id: number) => `screening:detail:${id}`;
const SCREENING_DETAIL_TTL_SECONDS = 60; // 60s — price/time changes are rare

const movieScreeningsKey = (movieId: number) => `screening:future:${movieId}`;
const MOVIE_SCREENINGS_TTL_SECONDS = 60; // 60s — new screenings are infrequent

const HALL_LIST_KEY = 'hall:list';
const HALL_LIST_TTL_SECONDS = 300; // 5m — hall metadata is almost static

/**
 * Cache-aside helper for screening seat maps, screening details,
 * future screenings by movie, and hall lists.
 * Every operation is best-effort: Redis errors degrade to Postgres.
 */
@Injectable()
export class ScreeningsCache {
  private readonly logger = new Logger(ScreeningsCache.name);

  constructor(private readonly redis: RedisCache) {}

  // ── Seat map ────────────────────────────────────────────────────────

  async getSeatMap(screeningId: number): Promise<SeatMapEntry[] | null> {
    try {
      const raw = await this.redis.get(seatMapKey(screeningId));
      return raw ? (JSON.parse(raw) as SeatMapEntry[]) : null;
    } catch (err) {
      this.logger.warn(
        `getSeatMap(${screeningId}) cache miss on error: ${String(err)}`,
      );
      return null;
    }
  }

  async setSeatMap(
    screeningId: number,
    seatMap: SeatMapEntry[],
  ): Promise<void> {
    try {
      await this.redis.set(
        seatMapKey(screeningId),
        JSON.stringify(seatMap),
        'EX',
        SEAT_MAP_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`setSeatMap(${screeningId}) failed: ${String(err)}`);
    }
  }

  async delSeatMap(screeningId: number): Promise<void> {
    try {
      await this.redis.del(seatMapKey(screeningId));
    } catch (err) {
      this.logger.warn(`delSeatMap(${screeningId}) failed: ${String(err)}`);
    }
  }

  // ── Screening detail ────────────────────────────────────────────────

  async getScreeningDetail(id: number): Promise<ScreeningWithMovieHall | null> {
    try {
      const raw = await this.redis.get(screeningDetailKey(id));
      return raw ? (JSON.parse(raw) as ScreeningWithMovieHall) : null;
    } catch (err) {
      this.logger.warn(
        `getScreeningDetail(${id}) cache miss on error: ${String(err)}`,
      );
      return null;
    }
  }

  async setScreeningDetail(screening: ScreeningWithMovieHall): Promise<void> {
    try {
      await this.redis.set(
        screeningDetailKey(screening.id),
        JSON.stringify(screening),
        'EX',
        SCREENING_DETAIL_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `setScreeningDetail(${screening.id}) failed: ${String(err)}`,
      );
    }
  }

  async delScreeningDetail(id: number): Promise<void> {
    try {
      await this.redis.del(screeningDetailKey(id));
    } catch (err) {
      this.logger.warn(`delScreeningDetail(${id}) failed: ${String(err)}`);
    }
  }

  // ── Future screenings by movie ──────────────────────────────────────

  async getMovieScreenings(movieId: number): Promise<FutureScreening[] | null> {
    try {
      const raw = await this.redis.get(movieScreeningsKey(movieId));
      return raw ? (JSON.parse(raw) as FutureScreening[]) : null;
    } catch (err) {
      this.logger.warn(
        `getMovieScreenings(${movieId}) cache miss on error: ${String(err)}`,
      );
      return null;
    }
  }

  async setMovieScreenings(
    movieId: number,
    screenings: FutureScreening[],
  ): Promise<void> {
    try {
      await this.redis.set(
        movieScreeningsKey(movieId),
        JSON.stringify(screenings),
        'EX',
        MOVIE_SCREENINGS_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`setMovieScreenings(${movieId}) failed: ${String(err)}`);
    }
  }

  async delMovieScreenings(movieId: number): Promise<void> {
    try {
      await this.redis.del(movieScreeningsKey(movieId));
    } catch (err) {
      this.logger.warn(`delMovieScreenings(${movieId}) failed: ${String(err)}`);
    }
  }

  // ── Hall list ───────────────────────────────────────────────────────

  async getHalls(): Promise<Hall[] | null> {
    try {
      const raw = await this.redis.get(HALL_LIST_KEY);
      return raw ? (JSON.parse(raw) as Hall[]) : null;
    } catch (err) {
      this.logger.warn(`getHalls cache miss on error: ${String(err)}`);
      return null;
    }
  }

  async setHalls(halls: Hall[]): Promise<void> {
    try {
      await this.redis.set(
        HALL_LIST_KEY,
        JSON.stringify(halls),
        'EX',
        HALL_LIST_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`setHalls failed: ${String(err)}`);
    }
  }

  async delHalls(): Promise<void> {
    try {
      await this.redis.del(HALL_LIST_KEY);
    } catch (err) {
      this.logger.warn(`delHalls failed: ${String(err)}`);
    }
  }
}
