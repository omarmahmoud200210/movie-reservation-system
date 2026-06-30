import { Injectable, Logger } from '@nestjs/common';
import RedisCache from '../redis/redis.cache';
import { SeatMapEntry } from './screenings.service';

const seatMapKey = (screeningId: number) => `seat_map:screening:${screeningId}`;
const SEAT_MAP_TTL_SECONDS = 300; // 5m — seat status changes as seats are held

/**
 * Cache-aside helper for the screening seat map. This module owns the key +
 * value shape; the reservation/WebSocket module later pushes real-time
 * invalidation onto the same key. Best-effort: Redis errors degrade to DB.
 */
@Injectable()
export class ScreeningsCache {
  private readonly logger = new Logger(ScreeningsCache.name);

  constructor(private readonly redis: RedisCache) {}

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
}
