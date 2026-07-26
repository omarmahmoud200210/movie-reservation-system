import { Hall, Prisma } from '@prisma/client';
import RedisCache from '../redis/redis.cache';
import { ScreeningWithMovieHall } from './screenings.repository';
import { SeatMapEntry } from './screenings.service';
type FutureScreening = Prisma.ScreeningGetPayload<{
    select: {
        id: true;
        startTime: true;
        price: true;
        hall: {
            select: {
                id: true;
                name: true;
                capacity: true;
            };
        };
    };
}>;
export declare class ScreeningsCache {
    private readonly redis;
    private readonly logger;
    constructor(redis: RedisCache);
    getSeatMap(screeningId: number): Promise<SeatMapEntry[] | null>;
    setSeatMap(screeningId: number, seatMap: SeatMapEntry[]): Promise<void>;
    delSeatMap(screeningId: number): Promise<void>;
    getScreeningDetail(id: number): Promise<ScreeningWithMovieHall | null>;
    setScreeningDetail(screening: ScreeningWithMovieHall): Promise<void>;
    delScreeningDetail(id: number): Promise<void>;
    getMovieScreenings(movieId: number): Promise<FutureScreening[] | null>;
    setMovieScreenings(movieId: number, screenings: FutureScreening[]): Promise<void>;
    delMovieScreenings(movieId: number): Promise<void>;
    getHalls(): Promise<Hall[] | null>;
    setHalls(halls: Hall[]): Promise<void>;
    delHalls(): Promise<void>;
}
export {};
