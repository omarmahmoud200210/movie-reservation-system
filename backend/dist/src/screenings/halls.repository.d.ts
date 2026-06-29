import { Hall, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export type HallWithSeats = Prisma.HallGetPayload<{
    include: {
        seats: true;
    };
}>;
export declare class HallsRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private rowLabel;
    createHallWithSeats(input: {
        name: string;
        rows: number;
        seatsPerRow: number;
    }): Promise<HallWithSeats>;
    findHallWithSeats(id: number): Promise<HallWithSeats | null>;
    listHalls(): Promise<Hall[]>;
    findById(id: number): Promise<Hall | null>;
    deleteHall(id: number): Promise<Hall>;
    hasReservations(hallId: number): Promise<boolean>;
}
