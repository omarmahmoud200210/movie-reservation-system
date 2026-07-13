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

let redis: Redis | undefined;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_CACHE_HOST ?? 'localhost',
      port: Number(process.env.REDIS_CACHE_PORT ?? 6379),
    });
  }
  return redis;
}

/** Truncates every application table and flushes Redis, then re-seeds the
 * three fixed RefundPolicy rows. Call this in a beforeEach so every test
 * starts from a known-empty state. Reuses one shared Redis connection across
 * calls (created lazily on first use) instead of reconnecting every time —
 * call closeRedis() once per spec file's afterAll to release it. */
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

  await getRedis().flushall();
}

/** Closes the shared Redis connection opened by resetState(). Call once per
 * spec file's afterAll — otherwise Jest won't exit cleanly (open handle). */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = undefined;
  }
}
