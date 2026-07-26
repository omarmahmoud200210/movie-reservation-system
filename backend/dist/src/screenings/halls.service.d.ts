import { Hall } from '@prisma/client';
import { CreateHallDto } from './dto/create-hall.dto';
import { HallsRepository, HallWithSeats } from './halls.repository';
import { ScreeningsCache } from './screenings.cache';
export declare class HallsService {
    private readonly hallsRepo;
    private readonly screeningsCache;
    constructor(hallsRepo: HallsRepository, screeningsCache: ScreeningsCache);
    createHall(dto: CreateHallDto): Promise<HallWithSeats>;
    getHall(id: number): Promise<HallWithSeats>;
    listHalls(): Promise<Hall[]>;
    deleteHall(id: number): Promise<Hall>;
}
