import { Movie } from '@prisma/client';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { MoviesRepository } from './movies.repository';
export declare class MoviesService {
    private readonly moviesRepo;
    constructor(moviesRepo: MoviesRepository);
    createMovie(dto: CreateMovieDto): Promise<Movie>;
    updateMovie(id: number, dto: UpdateMovieDto): Promise<Movie>;
    publish(id: number): Promise<Movie>;
    unpublish(id: number): Promise<Movie>;
    deleteMovie(id: number): Promise<Movie>;
    listAllForAdmin(): Promise<Movie[]>;
    private getExisting;
}
