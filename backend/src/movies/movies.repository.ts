import { Injectable } from '@nestjs/common';
import { Movie, MovieStatus, Prisma, ScreenStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A published movie tagged with whether it has any future scheduled screening. */
export type MovieWithFutureFlag = Movie & { screens: { id: number }[] };

@Injectable()
export class MoviesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Status defaults to DRAFT via the schema default. */
  create(data: Prisma.MovieCreateInput): Promise<Movie> {
    return this.prisma.write.movie.create({ data });
  }

  update(id: number, data: Prisma.MovieUpdateInput): Promise<Movie> {
    return this.prisma.write.movie.update({ where: { id }, data });
  }

  findById(id: number): Promise<Movie | null> {
    return this.prisma.read.movie.findUnique({ where: { id } });
  }

  setStatus(id: number, status: MovieStatus): Promise<Movie> {
    return this.prisma.write.movie.update({ where: { id }, data: { status } });
  }

  delete(id: number): Promise<Movie> {
    return this.prisma.write.movie.delete({ where: { id } });
  }

  /** All movies including drafts (admin listing). */
  listAll(): Promise<Movie[]> {
    return this.prisma.read.movie.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** A single PUBLISHED movie (drafts are invisible to the public). */
  findPublishedById(id: number): Promise<Movie | null> {
    return this.prisma.read.movie.findFirst({
      where: { id, status: MovieStatus.PUBLISHED },
    });
  }

  /**
   * All PUBLISHED movies, each carrying up to one future SCHEDULED screening id
   * so the service can split now-showing (has one) from coming-soon (has none).
   */
  findPublishedForBrowse(now: Date): Promise<MovieWithFutureFlag[]> {
    return this.prisma.read.movie.findMany({
      where: { status: MovieStatus.PUBLISHED },
      include: {
        screens: {
          where: { status: ScreenStatus.SCHEDULED, startTime: { gt: now } },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** True if any reservation exists on any screening of this movie. */
  async hasReservations(movieId: number): Promise<boolean> {
    const reservations = await this.prisma.read.reservation.findFirst({
      where: { screen: { movieId } },
      select: { id: true },
    });
    return reservations !== null;
  }
}
