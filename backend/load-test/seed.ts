// backend/load-test/seed.ts
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { PrismaClient, MovieStatus, ScreenStatus, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const USER_COUNT = 2500;
const SEAT_COUNT = 3000;
const SEATS_PER_ROW = 50;
const LOAD_TEST_PASSWORD = 'LoadTest123!';
const HOT_SCREENING_COUNT = 20;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log(`Hashing shared password for ${USER_COUNT} test users...`);
  const passwordHash = await bcrypt.hash(LOAD_TEST_PASSWORD, 10);

  console.log(`Creating ${USER_COUNT} test users...`);
  await prisma.user.createMany({
    data: Array.from({ length: USER_COUNT }, (_, i) => ({
      name: `Load Test User ${i}`,
      email: `loadtest${i}@test.local`,
      password: passwordHash,
      emailVerified: true,
      role: UserRole.USER,
    })),
  });

  console.log('Creating load-test hall...');
  const hall = await prisma.hall.create({
    data: { name: 'Load Test Hall', capacity: SEAT_COUNT },
  });

  console.log(`Creating ${SEAT_COUNT} seats...`);
  await prisma.seat.createMany({
    data: Array.from({ length: SEAT_COUNT }, (_, i) => ({
      hallId: hall.id,
      row: `R${Math.floor(i / SEATS_PER_ROW)}`,
      number: `${i % SEATS_PER_ROW}`,
    })),
  });

  console.log('Creating load-test movie...');
  const movie = await prisma.movie.create({
    data: {
      name: 'Load Test Movie',
      description: 'Seeded fixture for load testing — not a real movie.',
      duration: 120,
      posterImgUrl: 'https://example.com/load-test-poster.jpg',
      movieType: '2D',
      rating: 0,
      language: 'en',
      genre: 'Test',
      status: MovieStatus.PUBLISHED,
    },
  });

  console.log('Creating load-test screening...');
  const screening = await prisma.screening.create({
    data: {
      hallId: hall.id,
      movieId: movie.id,
      startTime: new Date(Date.now() + 24 * 60 * 60_000),
      status: ScreenStatus.SCHEDULED,
      price: 1000,
    },
  });

  const seats = await prisma.seat.findMany({
    where: { hallId: hall.id },
    orderBy: { id: 'asc' },
    take: HOT_SCREENING_COUNT + 1,
  });
  const [firstSeat, ...hotContentionSeats] = seats;

  console.log(`Creating ${HOT_SCREENING_COUNT} hot screenings for multi-contention...`);
  const hotScreenings: { screeningId: number; hotSeatId: number }[] = [];
  for (const seat of hotContentionSeats) {
    const hotScreening = await prisma.screening.create({
      data: {
        hallId: hall.id,
        movieId: movie.id,
        startTime: new Date(Date.now() + 24 * 60 * 60_000),
        status: ScreenStatus.SCHEDULED,
        price: 1000,
      },
    });
    hotScreenings.push({ screeningId: hotScreening.id, hotSeatId: seat.id });
  }

  const output = {
    screeningId: screening.id,
    hotSeatId: firstSeat.id,
    hotScreenings,
  };
  fs.writeFileSync(
    path.join(__dirname, 'seed-output.json'),
    JSON.stringify(output, null, 2),
  );

  console.log('Seed complete:', output);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});