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
import { MoviesCache } from './movies.cache';

@Injectable()
export class MoviesService {
  constructor(
    private readonly moviesRepo: MoviesRepository,
    private readonly moviesCache: MoviesCache,
  ) {}

  createMovie(dto: CreateMovieDto): Promise<Movie> {
    // status defaults to DRAFT in the schema — a draft is invisible to public
    // reads, so there is nothing to invalidate.
    return this.moviesRepo.create(dto);
  }

  async updateMovie(id: number, dto: UpdateMovieDto): Promise<Movie> {
    await this.getExisting(id);
    const movie = await this.moviesRepo.update(id, dto);
    await this.moviesCache.delMovie(id);
    return movie;
  }

  async publish(id: number): Promise<Movie> {
    const movie = await this.getExisting(id);
    if (movie.status === MovieStatus.PUBLISHED) {
      throw new BadRequestException('Movie is already published');
    }
    const published = await this.moviesRepo.setStatus(
      id,
      MovieStatus.PUBLISHED,
    );
    // Movie now appears in the browse lists.
    await this.moviesCache.delLists();
    return published;
  }

  async unpublish(id: number): Promise<Movie> {
    const movie = await this.getExisting(id);
    if (movie.status === MovieStatus.DRAFT) {
      throw new BadRequestException('Movie is already a draft');
    }
    const draft = await this.moviesRepo.setStatus(id, MovieStatus.DRAFT);
    // Movie disappears from public detail + browse lists.
    await this.moviesCache.delMovie(id);
    await this.moviesCache.delLists();
    return draft;
  }

  async deleteMovie(id: number): Promise<Movie> {
    await this.getExisting(id);
    if (await this.moviesRepo.hasReservations(id)) {
      throw new ConflictException(
        'Cannot delete a movie with existing reservations; unpublish it instead',
      );
    }
    const deleted = await this.moviesRepo.delete(id);
    await this.moviesCache.delMovie(id);
    await this.moviesCache.delLists();
    return deleted;
  }

  listAllForAdmin(): Promise<Movie[]> {
    return this.moviesRepo.listAll();
  }

  /**
   * Public browse: split published movies into now-showing (has a future
   * scheduled screening) and coming-soon (none). The future-screening marker
   * is stripped from the returned movies.
   */
  async browseMovies(): Promise<{ nowShowing: Movie[]; comingSoon: Movie[] }> {
    const cached = await this.moviesCache.getLists();
    if (cached) {
      return cached;
    }

    const movies = await this.moviesRepo.findPublishedForBrowse(new Date());
    const nowShowing: Movie[] = [];
    const comingSoon: Movie[] = [];
    for (const { screens, ...movie } of movies) {
      if (screens.length > 0) {
        nowShowing.push(movie);
      } else {
        comingSoon.push(movie);
      }
    }

    const lists = { nowShowing, comingSoon };
    await this.moviesCache.setLists(lists);
    return lists;
  }

  async getPublishedMovie(id: number): Promise<Movie> {
    const cached = await this.moviesCache.getMovie(id);
    if (cached) {
      return cached;
    }

    const movie = await this.moviesRepo.findPublishedById(id);
    if (!movie) {
      throw new NotFoundException(`Movie ${id} not found`);
    }
    await this.moviesCache.setMovie(movie);
    return movie;
  }

  private async getExisting(id: number): Promise<Movie> {
    const movie = await this.moviesRepo.findById(id);
    if (!movie) {
      throw new NotFoundException(`Movie ${id} not found`);
    }
    return movie;
  }
}
