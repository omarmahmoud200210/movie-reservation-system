import { Movie } from '@prisma/client';
import RedisCache from '../redis/redis.cache';
export interface BrowseLists {
    nowShowing: Movie[];
    comingSoon: Movie[];
}
export declare class MoviesCache {
    private readonly redis;
    private readonly logger;
    constructor(redis: RedisCache);
    getMovie(id: number): Promise<Movie | null>;
    setMovie(movie: Movie): Promise<void>;
    delMovie(id: number): Promise<void>;
    getLists(): Promise<BrowseLists | null>;
    setLists(lists: BrowseLists): Promise<void>;
    delLists(): Promise<void>;
}
