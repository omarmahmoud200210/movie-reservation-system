import { Screening, SeatStatus } from '@prisma/client';
import { MoviesRepository } from '../movies/movies.repository';
import { MoviesCache } from '../movies/movies.cache';
import { HallsRepository } from './halls.repository';
import { ScreeningsRepository, ScreeningWithMovieHall } from './screenings.repository';
import { ScreeningsCache } from './screenings.cache';
import { CreateScreeningDto } from './dto/create-screening.dto';
import { UpdateScreeningDto } from './dto/update-screening.dto';
export interface SeatMapEntry {
    seatId: number;
    row: string;
    number: string;
    status: SeatStatus;
}
export interface ScreeningSummary {
    screeningId: number;
    capacity: number;
    held: number;
    booked: number;
    available: number;
    reserved: number;
}
export declare class ScreeningsService {
    private readonly screeningsRepo;
    private readonly moviesRepo;
    private readonly hallsRepo;
    private readonly screeningsCache;
    private readonly moviesCache;
    constructor(screeningsRepo: ScreeningsRepository, moviesRepo: MoviesRepository, hallsRepo: HallsRepository, screeningsCache: ScreeningsCache, moviesCache: MoviesCache);
    createScreening(dto: CreateScreeningDto): Promise<Screening>;
    updateScreening(id: number, dto: UpdateScreeningDto): Promise<Screening>;
    cancelScreening(id: number): Promise<Screening>;
    deleteScreening(id: number): Promise<Screening>;
    getScreeningDetail(id: number): Promise<ScreeningWithMovieHall>;
    getMovieScreenings(movieId: number): Promise<{
        id: number;
        hall: {
            name: string;
            capacity: number;
            id: number;
        };
        startTime: Date;
        price: number;
    }[]>;
    getSeatMap(screeningId: number): Promise<SeatMapEntry[]>;
    getScreeningSummary(screeningId: number): Promise<ScreeningSummary>;
    private toSeatStatus;
    private assertNoOverlap;
    private computeEnd;
    private getExisting;
}
