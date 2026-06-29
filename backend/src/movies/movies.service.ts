import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Movie, MovieStatus } from '@prisma/client';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { MoviesRepository } from './movies.repository';

@Injectable()
export class MoviesService {
  constructor(private readonly moviesRepo: MoviesRepository) {}

  createMovie(dto: CreateMovieDto): Promise<Movie> {
    // status defaults to DRAFT in the schema
    return this.moviesRepo.create(dto);
  }

  async updateMovie(id: number, dto: UpdateMovieDto): Promise<Movie> {
    await this.getExisting(id);
    return this.moviesRepo.update(id, dto);
  }

  async publish(id: number): Promise<Movie> {
    const movie = await this.getExisting(id);
    if (movie.status === MovieStatus.PUBLISHED) {
      throw new BadRequestException('Movie is already published');
    }
    return this.moviesRepo.setStatus(id, MovieStatus.PUBLISHED);
  }

  async unpublish(id: number): Promise<Movie> {
    const movie = await this.getExisting(id);
    if (movie.status === MovieStatus.DRAFT) {
      throw new BadRequestException('Movie is already a draft');
    }
    return this.moviesRepo.setStatus(id, MovieStatus.DRAFT);
  }

  async deleteMovie(id: number): Promise<Movie> {
    await this.getExisting(id);
    if (await this.moviesRepo.hasReservations(id)) {
      throw new ConflictException(
        'Cannot delete a movie with existing reservations; unpublish it instead',
      );
    }
    return this.moviesRepo.delete(id);
  }

  listAllForAdmin(): Promise<Movie[]> {
    return this.moviesRepo.listAll();
  }

  private async getExisting(id: number): Promise<Movie> {
    const movie = await this.moviesRepo.findById(id);
    if (!movie) {
      throw new NotFoundException(`Movie ${id} not found`);
    }
    return movie;
  }
}
