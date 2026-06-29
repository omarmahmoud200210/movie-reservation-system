import { Module } from '@nestjs/common';
import { MoviesModule } from '../movies/movies.module';
import { HallsAdminController } from './halls-admin.controller';
import { HallsService } from './halls.service';
import { HallsRepository } from './halls.repository';
import { ScreeningsAdminController } from './screenings-admin.controller';
import { ScreeningsService } from './screenings.service';
import { ScreeningsRepository } from './screenings.repository';

/**
 * Screenings + halls module — admin scheduling with hall-overlap protection
 * and public seat-map reads. Imports MoviesModule for `MoviesRepository`
 * (needed to read movie duration when computing screening end times).
 * PrismaModule and RedisModule (REDIS_CACHE) are global, so no explicit import.
 */
@Module({
  imports: [MoviesModule],
  controllers: [HallsAdminController, ScreeningsAdminController],
  providers: [
    HallsService,
    HallsRepository,
    ScreeningsService,
    ScreeningsRepository,
  ],
  exports: [HallsService, HallsRepository, ScreeningsService, ScreeningsRepository],
})
export class ScreeningsModule {}
