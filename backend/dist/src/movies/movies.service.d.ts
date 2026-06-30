import { Movie } from '@prisma/client';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { MoviesRepository } from './movies.repository';
import { MoviesCache } from './movies.cache';
export declare class MoviesService {
    private readonly moviesRepo;
    private readonly moviesCache;
    constructor(moviesRepo: MoviesRepository, moviesCache: MoviesCache);
    createMovie(dto: CreateMovieDto): Promise<Movie>;
    updateMovie(id: number, dto: UpdateMovieDto): Promise<Movie>;
    publish(id: number): Promise<Movie>;
    unpublish(id: number): Promise<Movie>;
    deleteMovie(id: number): Promise<Movie>;
    listAllForAdmin(): Promise<Movie[]>;
    browseMovies(): Promise<{
        nowShowing: Movie[];
        comingSoon: Movie[];
    }>;
    getPublishedMovie(id: number): Promise<Movie>;
    private getExisting;
}
