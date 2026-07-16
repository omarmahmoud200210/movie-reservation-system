import { CreateHallDto } from './dto/create-hall.dto';
import { HallsService } from './halls.service';
export declare class HallsAdminController {
    private readonly hallsService;
    constructor(hallsService: HallsService);
    create(dto: CreateHallDto): Promise<{
        seats: {
            number: string;
            createdAt: Date;
            updatedAt: Date;
            id: number;
            hallId: number;
            row: string;
        }[];
    } & {
        name: string;
        capacity: number;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    list(): Promise<{
        name: string;
        capacity: number;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }[]>;
    getOne(id: number): Promise<{
        seats: {
            number: string;
            createdAt: Date;
            updatedAt: Date;
            id: number;
            hallId: number;
            row: string;
        }[];
    } & {
        name: string;
        capacity: number;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    remove(id: number): Promise<{
        name: string;
        capacity: number;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
}
