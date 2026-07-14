import {
  PrismaClient,
  MovieStatus,
  ScreenStatus,
  Hall,
  Movie,
  Screening,
  Seat,
} from '@prisma/client';

export async function createHallWithSeats(
  prisma: PrismaClient,
  opts: { rows?: number; seatsPerRow?: number; name?: string } = {},
): Promise<{ hall: Hall; seats: Seat[] }> {
  const rows = opts.rows ?? 2;
  const seatsPerRow = opts.seatsPerRow ?? 5;
  if (rows > 26)
    throw new Error(
      'createHallWithSeats: rows > 26 not supported, add base-26 row labels if needed',
    );

  const hall = await prisma.hall.create({
    data: { name: opts.name ?? 'E2E Hall', capacity: rows * seatsPerRow },
  });

  const rowLabels = Array.from({ length: rows }, (_, i) =>
    String.fromCharCode(65 + i),
  );
  await prisma.seat.createMany({
    data: rowLabels.flatMap((row) =>
      Array.from({ length: seatsPerRow }, (_, i) => ({
        hallId: hall.id,
        row,
        number: String(i + 1),
      })),
    ),
  });

  const seats = await prisma.seat.findMany({
    where: { hallId: hall.id },
    orderBy: [{ row: 'asc' }, { id: 'asc' }],
  });
  return { hall, seats };
}

export function createPublishedMovie(
  prisma: PrismaClient,
  overrides: Partial<{ name: string }> = {},
): Promise<Movie> {
  return prisma.movie.create({
    data: {
      name: overrides.name ?? 'E2E Test Movie',
      description: 'A movie used only by e2e tests',
      duration: 120,
      posterImgUrl: 'https://example.com/poster.jpg',
      movieType: '2D',
      rating: 7.5,
      language: 'en',
      genre: 'Drama',
      status: MovieStatus.PUBLISHED,
    },
  });
}

export function createScreening(
  prisma: PrismaClient,
  opts: { movieId: number; hallId: number; startTime: Date; price?: number },
): Promise<Screening> {
  return prisma.screening.create({
    data: {
      movieId: opts.movieId,
      hallId: opts.hallId,
      startTime: opts.startTime,
      price: opts.price ?? 50,
      status: ScreenStatus.SCHEDULED,
    },
  });
}
