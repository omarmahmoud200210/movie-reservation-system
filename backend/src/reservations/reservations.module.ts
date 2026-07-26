import { Module, forwardRef } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './reservations.repository';
import { ReservationCacheListener } from './listeners/reservation-cache.listener';
import { ReservationMetricsListener } from './listeners/reservation-metrics.listener';
import {
  CONCURRENCY_LIMIT,
  ConcurrencyGuard,
} from '../common/guards/concurrency.guard';
import {
  RESERVATION_BREAKER_OPTIONS,
  ReservationBreaker,
} from './reservation-breaker.service';

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
    ConcurrencyGuard,
    { provide: CONCURRENCY_LIMIT, useValue: 4 },
    ReservationBreaker,
    {
      provide: RESERVATION_BREAKER_OPTIONS,
      useValue: {
        errorThresholdPercentage: 50,
        resetTimeout: 30_000,
        volumeThreshold: 10,
      },
    },
  ],
  exports: [ReservationsService],
})
export class ReservationsModule {}
