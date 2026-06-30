import RedisCache from '../redis/redis.cache';
import { SeatMapEntry } from './screenings.service';
export declare class ScreeningsCache {
    private readonly redis;
    private readonly logger;
    constructor(redis: RedisCache);
    getSeatMap(screeningId: number): Promise<SeatMapEntry[] | null>;
    setSeatMap(screeningId: number, seatMap: SeatMapEntry[]): Promise<void>;
    delSeatMap(screeningId: number): Promise<void>;
}
