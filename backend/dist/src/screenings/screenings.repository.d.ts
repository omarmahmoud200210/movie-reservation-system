import { Prisma, ReservationStatus, Screening, ScreenStatus, Seat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export type ScreeningWithMovieHall = Prisma.ScreeningGetPayload<{
    include: {
        movie: true;
        hall: true;
    };
}>;
export declare class ScreeningsRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(data: Prisma.ScreeningUncheckedCreateInput): Promise<Screening>;
    update(id: number, data: Prisma.ScreeningUncheckedUpdateInput): Promise<Screening>;
    findById(id: number): Promise<ScreeningWithMovieHall | null>;
    setStatus(id: number, status: ScreenStatus): Promise<Screening>;
    delete(id: number): Promise<Screening>;
    hasReservations(screeningId: number): Promise<boolean>;
    findOverlapping(hallId: number, start: Date, end: Date, excludeId?: number): Promise<Screening[]>;
    findFutureScheduledByMovie(movieId: number, now: Date): Prisma.PrismaPromise<{
        hall: {
            name: string;
            id: number;
            capacity: number;
        };
        id: number;
        startTime: Date;
        price: number;
    }[]>;
    findSeatsByHall(hallId: number): Promise<Seat[]>;
    findActiveReservations(screeningId: number): Promise<{
        seatId: number;
        status: ReservationStatus;
    }[]>;
}
