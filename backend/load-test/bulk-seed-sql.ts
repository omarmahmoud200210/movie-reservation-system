// backend/load-test/bulk-seed-sql.ts
//
// Tiny runner for the pure-SQL bulk loader in load-test/sql/. It does NOT
// generate any data itself - it just connects, sets a fixed random seed for
// reproducibility, and executes each .sql file in FK order.
//
// Usage (from backend/):
//   npm run db:bulk-seed -- --smoke               # ~100k reservations, quick check
//   npm run db:bulk-seed -- --clean               # TRUNCATE all tables, then load ~10M
//   npm run db:bulk-seed -- --reservations 10000  # target a specific row count
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

const DIRECT_URL = process.env.DIRECT_URL;

const CLEAN = process.argv.includes('--clean') || process.env.BULK_CLEAN === '1';
const SMOKE = process.argv.includes('--smoke') || process.env.BULK_SMOKE === '1';

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const SEATS_PER_HALL = 150;
const RESERVATIONS_TARGET = Number(
  argValue('--reservations') ?? process.env.BULK_RESERVATIONS ?? 10_000_000,
);
const SCREENINGS = SMOKE
  ? 670
  : Math.max(1, Math.ceil(RESERVATIONS_TARGET / SEATS_PER_HALL));

const SQL_DIR = path.join(__dirname, 'sql');
const FILES = [
  '00-reset.sql',
  '01-refund-policy.sql',
  '02-movies.sql',
  '03-halls.sql',
  '04-seats.sql',
  '05-users.sql',
  '06-screenings.sql',
  '07-reservations.sql',
  '08-payments-confirmed.sql',
  '09-payments-failed.sql',
  '10-analyze.sql',
];

async function main() {
  const pool = new Pool({ connectionString: DIRECT_URL, max: 1 });
  const client = await pool.connect();
  console.log('Connected to', DIRECT_URL!.replace(/:[^:/@]+@/, ':***@'));

  if (CLEAN) {
    console.log('Truncating all tables (RESTART IDENTITY CASCADE)...');
    await runFile(client, '00-reset.sql');
  } else {
    const existing = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM "refund_policy") OR
        EXISTS(SELECT 1 FROM "movie") OR
        EXISTS(SELECT 1 FROM "hall") OR
        EXISTS(SELECT 1 FROM "seat") OR
        EXISTS(SELECT 1 FROM "user") OR
        EXISTS(SELECT 1 FROM "screening") OR
        EXISTS(SELECT 1 FROM "reservation") OR
        EXISTS(SELECT 1 FROM "payment") AS has_data
    `);
    if (existing.rows[0].has_data) {
      throw new Error(
        'Database is not empty. Re-run with --clean to truncate before bulk-loading.',
      );
    }
  }

  console.log(`Using fixed random seed 0.42 (${SCREENINGS.toLocaleString()} screenings)`);
  await client.query('SELECT setseed(0.42)');

  const filesToRun = CLEAN ? FILES : FILES.slice(1);
  for (const file of filesToRun) {
    await runFile(client, file);
  }

  await printCounts(client);

  client.release();
  await pool.end();
  console.log('Bulk seed complete.');
}

async function runFile(client: import('pg').PoolClient, file: string): Promise<void> {
  const sqlPath = path.join(SQL_DIR, file);
  const started = Date.now();
  let sql = fs.readFileSync(sqlPath, 'utf8');
  if (file === '06-screenings.sql') {
    sql = sql.replaceAll('__SCREENINGS__', String(SCREENINGS));
  }
  console.log(`  [${file}] running...`);
  await client.query(sql);
  console.log(`  [${file}] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function printCounts(client: import('pg').PoolClient): Promise<void> {
  const counts = await client.query(`
    SELECT 'user' t, count(*) c FROM "user"
    UNION ALL SELECT 'movie', count(*) FROM "movie"
    UNION ALL SELECT 'hall', count(*) FROM "hall"
    UNION ALL SELECT 'seat', count(*) FROM "seat"
    UNION ALL SELECT 'screening', count(*) FROM "screening"
    UNION ALL SELECT 'reservation', count(*) FROM "reservation"
    UNION ALL SELECT 'payment', count(*) FROM "payment"
  `);
  console.log('Final counts:');
  for (const row of counts.rows) {
    console.log(`  ${String(row.t).padEnd(12)} ${Number(row.c).toLocaleString()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});