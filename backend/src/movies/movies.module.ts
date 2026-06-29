import { Module } from '@nestjs/common';

/**
 * Movie catalog module — admin authoring + public browse.
 * Controllers/providers are added in later phases (halls/movies/screenings).
 * PrismaModule and RedisModule (REDIS_CACHE) are global, so no explicit import needed.
 */
@Module({})
export class MoviesModule {}
