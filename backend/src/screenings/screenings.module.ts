import { Module } from '@nestjs/common';

/**
 * Screenings + halls module — admin scheduling with hall-overlap protection
 * and public seat-map reads. Controllers/providers are added in later phases.
 * PrismaModule and RedisModule (REDIS_CACHE) are global, so no explicit import needed.
 */
@Module({})
export class ScreeningsModule {}
