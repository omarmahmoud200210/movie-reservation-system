import { Module } from '@nestjs/common';
import { MoviesAdminController } from './movies-admin.controller';
import { MoviesService } from './movies.service';
import { MoviesRepository } from './movies.repository';

/**
 * Movie catalog module — admin authoring + public browse.
 * Public browse/detail controllers are added in Phase 4.
 * PrismaModule and RedisModule (REDIS_CACHE) are global, so no explicit import needed.
 */
@Module({
  controllers: [MoviesAdminController],
  providers: [MoviesService, MoviesRepository],
  exports: [MoviesService, MoviesRepository],
})
export class MoviesModule {}
