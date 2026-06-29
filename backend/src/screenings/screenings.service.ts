import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Screening, ScreenStatus } from '@prisma/client';
import { MoviesRepository } from '../movies/movies.repository';
import { HallsRepository } from './halls.repository';
import {
  ScreeningsRepository,
  ScreeningWithMovieHall,
} from './screenings.repository';
import { CreateScreeningDto } from './dto/create-screening.dto';
import { UpdateScreeningDto } from './dto/update-screening.dto';

@Injectable()
export class ScreeningsService {
  constructor(
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly moviesRepo: MoviesRepository,
    private readonly hallsRepo: HallsRepository,
  ) {}

  async createScreening(dto: CreateScreeningDto): Promise<Screening> {
    const movie = await this.moviesRepo.findById(dto.movieId);
    if (!movie) {
      throw new NotFoundException(`Movie ${dto.movieId} not found`);
    }
    const hall = await this.hallsRepo.findById(dto.hallId);
    if (!hall) {
      throw new NotFoundException(`Hall ${dto.hallId} not found`);
    }

    const start = new Date(dto.startTime);
    const end = this.computeEnd(start, movie.duration);
    await this.assertNoOverlap(dto.hallId, start, end);

    return this.screeningsRepo.create({
      movieId: dto.movieId,
      hallId: dto.hallId,
      startTime: start,
      price: dto.price,
    });
  }

  async updateScreening(
    id: number,
    dto: UpdateScreeningDto,
  ): Promise<Screening> {
    const existing = await this.getExisting(id);

    const hallId = dto.hallId ?? existing.hallId;
    const start = dto.startTime ? new Date(dto.startTime) : existing.startTime;

    // Resolve the effective movie duration (only re-fetch if movie changed).
    let duration = existing.movie.duration;
    if (dto.movieId !== undefined && dto.movieId !== existing.movieId) {
      const movie = await this.moviesRepo.findById(dto.movieId);
      if (!movie) {
        throw new NotFoundException(`Movie ${dto.movieId} not found`);
      }
      duration = movie.duration;
    }
    if (dto.hallId !== undefined && dto.hallId !== existing.hallId) {
      const hall = await this.hallsRepo.findById(dto.hallId);
      if (!hall) {
        throw new NotFoundException(`Hall ${dto.hallId} not found`);
      }
    }

    const end = this.computeEnd(start, duration);
    await this.assertNoOverlap(hallId, start, end, id);

    const data: Prisma.ScreeningUncheckedUpdateInput = {};
    if (dto.movieId !== undefined) data.movieId = dto.movieId;
    if (dto.hallId !== undefined) data.hallId = dto.hallId;
    if (dto.startTime !== undefined) data.startTime = start;
    if (dto.price !== undefined) data.price = dto.price;

    return this.screeningsRepo.update(id, data);
  }

  async cancelScreening(id: number): Promise<Screening> {
    const existing = await this.getExisting(id);
    if (existing.status === ScreenStatus.CANCELLED) {
      throw new BadRequestException('Screening is already cancelled');
    }
    return this.screeningsRepo.setStatus(id, ScreenStatus.CANCELLED);
  }

  async deleteScreening(id: number): Promise<Screening> {
    await this.getExisting(id);
    if (await this.screeningsRepo.hasReservations(id)) {
      throw new ConflictException(
        'Cannot delete a screening with existing reservations; cancel it instead',
      );
    }
    return this.screeningsRepo.delete(id);
  }

  private async assertNoOverlap(
    hallId: number,
    start: Date,
    end: Date,
    excludeId?: number,
  ): Promise<void> {
    const overlapping = await this.screeningsRepo.findOverlapping(
      hallId,
      start,
      end,
      excludeId,
    );
    if (overlapping.length > 0) {
      throw new ConflictException(
        'Hall already has a screening scheduled in this time range',
      );
    }
  }

  private computeEnd(start: Date, durationMinutes: number): Date {
    return new Date(start.getTime() + durationMinutes * 60_000);
  }

  private async getExisting(id: number): Promise<ScreeningWithMovieHall> {
    const screening = await this.screeningsRepo.findById(id);
    if (!screening) {
      throw new NotFoundException(`Screening ${id} not found`);
    }
    return screening;
  }
}
