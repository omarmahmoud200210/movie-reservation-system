import { Module, forwardRef } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './reservations.repository';
import { ReservationCacheListener } from './listeners/reservation-cache.listener';
import { ReservationMetricsListener } from './listeners/reservation-metrics.listener';

/**
 * Reservations (HTTP) — hold, cancel, and list a user's seat reservations.
 * Imports ScreeningsModule for `ScreeningsRepository` (screening lookup) and
 * `ScreeningsCache` (seat-map invalidation via the event listener). Prisma and
 * the in-process event emitter are global. Exports `ReservationsService` so
 * the cron module can trigger `expireHolds` on a schedule.
 */
@Module({
  imports: [ScreeningsModule, forwardRef(() => PaymentsModule)],
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    ReservationsRepository,
    ReservationCacheListener,
    ReservationMetricsListener,
  ],
  exports: [ReservationsService],
})
export class ReservationsModule {}
