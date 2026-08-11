import { CreateHallDto } from './dto/create-hall.dto';
import { HallsService } from './halls.service';
export declare class HallsAdminController {
    private readonly hallsService;
    constructor(hallsService: HallsService);
    create(dto: CreateHallDto): Promise<{
        seats: {
            number: string;
            id: number;
            createdAt: Date;
            updatedAt: Date;
            hallId: number;
            row: string;
        }[];
    } & {
        name: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        capacity: number;
    }>;
    list(): Promise<{
        name: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        capacity: number;
    }[]>;
    getOne(id: number): Promise<{
        seats: {
            number: string;
            id: number;
            createdAt: Date;
            updatedAt: Date;
            hallId: number;
            row: string;
        }[];
    } & {
        name: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        capacity: number;
    }>;
    remove(id: number): Promise<{
        name: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        capacity: number;
    }>;
}
