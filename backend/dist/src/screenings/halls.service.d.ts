import { Hall } from '@prisma/client';
import { CreateHallDto } from './dto/create-hall.dto';
import { HallsRepository, HallWithSeats } from './halls.repository';
export declare class HallsService {
    private readonly hallsRepo;
    constructor(hallsRepo: HallsRepository);
    createHall(dto: CreateHallDto): Promise<HallWithSeats>;
    getHall(id: number): Promise<HallWithSeats>;
    listHalls(): Promise<Hall[]>;
    deleteHall(id: number): Promise<Hall>;
}
