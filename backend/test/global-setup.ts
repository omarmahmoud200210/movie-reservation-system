import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

const RUNTIME_ENV_PATH = path.resolve(__dirname, '.env.test.runtime');

declare global {
  var __TESTCONTAINERS__:
    | { postgres: StartedPostgreSqlContainer; redis: StartedRedisContainer }
    | undefined;
}

export default async function globalSetup(): Promise<void> {
  const postgres = await new PostgreSqlContainer('postgres:16')
    .withDatabase('movie_reservation_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .withReuse()
    .start();

  const redis = await new RedisContainer('redis:7').withReuse().start();

  global.__TESTCONTAINERS__ = { postgres, redis };

  const databaseUrl = postgres.getConnectionUri();

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
    },
    stdio: 'inherit',
  });

  const runtimeEnv = [
    `DATABASE_URL=${databaseUrl}`,
    `REDIS_CACHE_HOST=${redis.getHost()}`,
    `REDIS_CACHE_PORT=${redis.getPort()}`,
    '',
  ].join('\n');

  fs.writeFileSync(RUNTIME_ENV_PATH, runtimeEnv, 'utf-8');
}
