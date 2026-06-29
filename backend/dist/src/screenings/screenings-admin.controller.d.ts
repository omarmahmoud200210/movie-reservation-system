import { CreateScreeningDto } from './dto/create-screening.dto';
import { UpdateScreeningDto } from './dto/update-screening.dto';
import { ScreeningsService } from './screenings.service';
export declare class ScreeningsAdminController {
    private readonly screeningsService;
    constructor(screeningsService: ScreeningsService);
    create(dto: CreateScreeningDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    update(id: number, dto: UpdateScreeningDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    cancel(id: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    remove(id: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
}
