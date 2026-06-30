import { Movie, MovieStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export type MovieWithFutureFlag = Movie & {
    screens: {
        id: number;
    }[];
};
export declare class MoviesRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(data: Prisma.MovieCreateInput): Promise<Movie>;
    update(id: number, data: Prisma.MovieUpdateInput): Promise<Movie>;
    findById(id: number): Promise<Movie | null>;
    setStatus(id: number, status: MovieStatus): Promise<Movie>;
    delete(id: number): Promise<Movie>;
    listAll(): Promise<Movie[]>;
    findPublishedById(id: number): Promise<Movie | null>;
    findPublishedForBrowse(now: Date): Promise<MovieWithFutureFlag[]>;
    hasReservations(movieId: number): Promise<boolean>;
}
