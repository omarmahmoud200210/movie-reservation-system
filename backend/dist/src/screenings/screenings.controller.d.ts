import { ScreeningsService } from './screenings.service';
export declare class ScreeningsController {
    private readonly screeningsService;
    constructor(screeningsService: ScreeningsService);
    movieScreenings(id: number): Promise<{
        hall: {
            name: string;
            id: number;
            capacity: number;
        };
        id: number;
        startTime: Date;
        price: number;
    }[]>;
    detail(id: number): Promise<{
        movie: {
            name: string;
            id: number;
            createdAt: Date;
            updatedAt: Date;
            status: import("@prisma/client").$Enums.MovieStatus;
            description: string;
            duration: number;
            posterImgUrl: string;
            movieType: string;
            rating: number;
            language: string;
            genre: string;
        };
        hall: {
            name: string;
            id: number;
            createdAt: Date;
            updatedAt: Date;
            capacity: number;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    seats(id: number): Promise<import("./screenings.service").SeatMapEntry[]>;
}
