import { Module } from '@nestjs/common';
import { MoviesModule } from '../movies/movies.module';
import { HallsAdminController } from './halls-admin.controller';
import { HallsService } from './halls.service';
import { HallsRepository } from './halls.repository';
import { ScreeningsController } from './screenings.controller';
import { ScreeningsAdminController } from './screenings-admin.controller';
import { ScreeningsService } from './screenings.service';
import { ScreeningsRepository } from './screenings.repository';
import { ScreeningsCache } from './screenings.cache';

/**
 * Screenings + halls module — admin scheduling with hall-overlap protection
 * and public seat-map reads. Imports MoviesModule for `MoviesRepository`
 * (needed to read movie duration when computing screening end times).
 * PrismaModule and RedisModule (REDIS_CACHE) are global, so no explicit import.
 */
@Module({
  imports: [MoviesModule],
  controllers: [
    HallsAdminController,
    ScreeningsAdminController,
    ScreeningsController,
  ],
  providers: [
    HallsService,
    HallsRepository,
    ScreeningsService,
    ScreeningsRepository,
    ScreeningsCache,
  ],
  exports: [
    HallsService,
    HallsRepository,
    ScreeningsService,
    ScreeningsRepository,
    ScreeningsCache,
  ],
})
export class ScreeningsModule {}
