import { Module } from '@nestjs/common';
import { MoviesController } from './movies.controller';
import { MoviesAdminController } from './movies-admin.controller';
import { MoviesService } from './movies.service';
import { MoviesRepository } from './movies.repository';
import { MoviesCache } from './movies.cache';

/**
 * Movie catalog module — admin authoring + public browse with Redis caching.
 * `MoviesCache` is exported so the screenings module can invalidate the browse
 * lists when screenings change. RedisModule (RedisCache) is global.
 */
@Module({
  controllers: [MoviesController, MoviesAdminController],
  providers: [MoviesService, MoviesRepository, MoviesCache],
  exports: [MoviesService, MoviesRepository, MoviesCache],
})
export class MoviesModule {}
