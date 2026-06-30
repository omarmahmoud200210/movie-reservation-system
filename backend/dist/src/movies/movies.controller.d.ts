import { MoviesService } from './movies.service';
export declare class MoviesController {
    private readonly moviesService;
    constructor(moviesService: MoviesService);
    browse(): Promise<{
        nowShowing: import("@prisma/client").Movie[];
        comingSoon: import("@prisma/client").Movie[];
    }>;
    detail(id: number): Promise<{
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
    }>;
}
