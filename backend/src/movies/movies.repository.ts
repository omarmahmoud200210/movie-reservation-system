import { Injectable } from '@nestjs/common';
import { Movie, MovieStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MoviesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Status defaults to DRAFT via the schema default. */
  create(data: Prisma.MovieCreateInput): Promise<Movie> {
    return this.prisma.movie.create({ data });
  }

  update(id: number, data: Prisma.MovieUpdateInput): Promise<Movie> {
    return this.prisma.movie.update({ where: { id }, data });
  }

  findById(id: number): Promise<Movie | null> {
    return this.prisma.movie.findUnique({ where: { id } });
  }

  setStatus(id: number, status: MovieStatus): Promise<Movie> {
    return this.prisma.movie.update({ where: { id }, data: { status } });
  }

  delete(id: number): Promise<Movie> {
    return this.prisma.movie.delete({ where: { id } });
  }

  /** All movies including drafts (admin listing). */
  listAll(): Promise<Movie[]> {
    return this.prisma.movie.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** True if any reservation exists on any screening of this movie. */
  async hasReservations(movieId: number): Promise<boolean> {
    const reservations = await this.prisma.reservation.findFirst({
      where: { screen: { movieId } },
      select: { id: true },
    });
    return reservations !== null;
  }
}
