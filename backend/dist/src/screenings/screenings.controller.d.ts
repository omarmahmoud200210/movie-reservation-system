import { ScreeningsService } from './screenings.service';
export declare class ScreeningsController {
    private readonly screeningsService;
    constructor(screeningsService: ScreeningsService);
    movieScreenings(id: number): Promise<{
        id: number;
        hall: {
            name: string;
            capacity: number;
            id: number;
        };
        startTime: Date;
        price: number;
    }[]>;
    detail(id: number): Promise<{
        hall: {
            name: string;
            capacity: number;
            createdAt: Date;
            updatedAt: Date;
            id: number;
        };
        movie: {
            name: string;
            createdAt: Date;
            updatedAt: Date;
            id: number;
            description: string;
            duration: number;
            posterImgUrl: string;
            movieType: string;
            rating: number;
            language: string;
            genre: string;
            status: import("@prisma/client").$Enums.MovieStatus;
        };
    } & {
        createdAt: Date;
        updatedAt: Date;
        id: number;
        status: import("@prisma/client").$Enums.ScreenStatus;
        startTime: Date;
        price: number;
        hallId: number;
        movieId: number;
    }>;
    seats(id: number): Promise<import("./screenings.service").SeatMapEntry[]>;
}
