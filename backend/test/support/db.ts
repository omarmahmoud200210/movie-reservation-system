// backend/test/support/db.ts
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const TABLES = [
  'reservation',
  'payment',
  'refund_policy',
  'screening',
  'seat',
  'hall',
  'movie',
  'user',
];

/** Truncates every application table and flushes Redis, then re-seeds the
 * three fixed RefundPolicy rows. Call this in a beforeEach so every test
 * starts from a known-empty state. */
export async function resetState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
  );

  await prisma.refundPolicy.createMany({
    data: [
      { hoursFrom: 48, hoursTo: 100_000, refundPercent: 100 },
      { hoursFrom: 24, hoursTo: 48, refundPercent: 50 },
      { hoursFrom: 0, hoursTo: 24, refundPercent: 0 },
    ],
  });

  const redis = new Redis({
    host: process.env.REDIS_CACHE_HOST ?? 'localhost',
    port: Number(process.env.REDIS_CACHE_PORT ?? 6379),
  });
  await redis.flushall();
  await redis.quit();
}
