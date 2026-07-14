import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { PaymentsModule } from '../payments/payments.module';
import { HoldExpiryCron } from './hold-expiry.cron';

/**
 * Scheduled jobs. Imports ReservationsModule for `ReservationsService`
 * (already exports it). This module holds no business logic of its own —
 * each file here is a thin `@Cron`-decorated trigger into an existing
 * domain service.
 */
@Module({
  imports: [ReservationsModule, PaymentsModule],
  providers: [HoldExpiryCron],
})
export class CronModule {}
