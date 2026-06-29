import { Screening } from '@prisma/client';
import { MoviesRepository } from '../movies/movies.repository';
import { HallsRepository } from './halls.repository';
import { ScreeningsRepository } from './screenings.repository';
import { CreateScreeningDto } from './dto/create-screening.dto';
import { UpdateScreeningDto } from './dto/update-screening.dto';
export declare class ScreeningsService {
    private readonly screeningsRepo;
    private readonly moviesRepo;
    private readonly hallsRepo;
    constructor(screeningsRepo: ScreeningsRepository, moviesRepo: MoviesRepository, hallsRepo: HallsRepository);
    createScreening(dto: CreateScreeningDto): Promise<Screening>;
    updateScreening(id: number, dto: UpdateScreeningDto): Promise<Screening>;
    cancelScreening(id: number): Promise<Screening>;
    deleteScreening(id: number): Promise<Screening>;
    private assertNoOverlap;
    private computeEnd;
    private getExisting;
}
