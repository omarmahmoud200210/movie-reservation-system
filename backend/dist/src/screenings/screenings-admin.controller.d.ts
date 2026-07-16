import { AuditService } from '../common/services/audit.service';
import type { AuthUser } from '../auth/token.service';
import { CreateScreeningDto } from './dto/create-screening.dto';
import { UpdateScreeningDto } from './dto/update-screening.dto';
import { ScreeningsService } from './screenings.service';
export declare class ScreeningsAdminController {
    private readonly screeningsService;
    private readonly audit;
    constructor(screeningsService: ScreeningsService, audit: AuditService);
    create(dto: CreateScreeningDto, user: AuthUser): Promise<{
        createdAt: Date;
        updatedAt: Date;
        id: number;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    update(id: number, dto: UpdateScreeningDto, user: AuthUser): Promise<{
        createdAt: Date;
        updatedAt: Date;
        id: number;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    cancel(id: number, user: AuthUser): Promise<{
        createdAt: Date;
        updatedAt: Date;
        id: number;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    remove(id: number, user: AuthUser): Promise<{
        createdAt: Date;
        updatedAt: Date;
        id: number;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
}
