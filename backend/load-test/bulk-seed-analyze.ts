// backend/load-test/bulk-seed-analyze.ts
//
// Read-only: runs EXPLAIN (ANALYZE, BUFFERS) on the app's real hot-path queries
// against the bulk-loaded dataset so you can watch index usage at scale.
//
// Usage: npm run db:bulk-seed:analyze
import 'dotenv/config';
import { Client } from 'pg';

const DIRECT_URL =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/moviereservationsystem';

interface Probe {
  label: string;
  sql: string;
  params: unknown[];
}

const probes: Probe[] = [
  {
    label: 'findByUser — all reservations of a user, ordered by createdAt desc',
    sql: `SELECT * FROM "reservation" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    params: [1],
  },
  {
    label: 'findActiveReservations — seat-map for a screening (HELD/CONFIRMED)',
    sql: `SELECT "seatId", "status" FROM "reservation" WHERE "screeningId" = $1 AND "status" IN ('HELD','CONFIRMED')`,
    params: [1],
  },
  {
    label: 'releaseExpiredHolds — expired HELD sweep (read form)',
    sql: `SELECT id, "userId", "screeningId", "seatId" FROM "reservation" WHERE status = 'HELD' AND "heldUntil" < $1`,
    params: [new Date()],
  },
  {
    label: 'findStuckTimedOut — timed-out payments older than a cutoff',
    sql: `SELECT * FROM "payment" WHERE status = 'TIMED_OUT' AND "createdAt" < $1`,
    params: [new Date()],
  },
  {
    label: 'findOverlapping — non-cancelled screenings of a hall',
    sql: `SELECT * FROM "screening" WHERE "hallId" = $1 AND status <> 'CANCELLED'`,
    params: [1],
  },
  {
    label: 'hasReservations(movie) — does any reservation exist on a movie',
    sql: `SELECT "reservation"."id" FROM "reservation" JOIN "screening" ON "screening"."id" = "reservation"."screeningId" WHERE "screening"."movieId" = $1 LIMIT 1`,
    params: [1],
  },
  {
    label: 'Aggregate — reservations grouped by movie (big-table scan)',
    sql: `SELECT s."movieId", count(*) FROM "screening" s JOIN "reservation" r ON r."screeningId" = s.id GROUP BY s."movieId" ORDER BY count(*) DESC LIMIT 10`,
    params: [],
  },
];

async function main() {
  const client = new Client({ connectionString: DIRECT_URL });
  await client.connect();
  console.log('Connected to', DIRECT_URL.replace(/:[^:/@]+@/, ':***@'));

  const sizes = await client.query(
    `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup DESC`,
  );
  console.log('\nTable sizes (last ANALYZE):');
  for (const r of sizes.rows) {
    console.log(`  ${String(r.relname).padEnd(16)} ${Number(r.n_live_tup).toLocaleString()}`);
  }

  for (const p of probes) {
    console.log(`\n=== ${p.label} ===`);
    try {
      const explained = await client.query(
        'EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ' + p.sql,
        p.params,
      );
      for (const row of explained.rows) {
        console.log('  ' + row['QUERY PLAN']);
      }
    } catch (err) {
      console.error('  EXPLAIN failed:', (err as Error).message);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});