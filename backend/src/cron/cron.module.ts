import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { HoldExpiryCron } from './hold-expiry.cron';

/**
 * Scheduled jobs. Imports ReservationsModule for `ReservationsService`
 * (already exports it). This module holds no business logic of its own —
 * each file here is a thin `@Cron`-decorated trigger into an existing
 * domain service.
 */
@Module({
  imports: [ReservationsModule],
  providers: [HoldExpiryCron],
})
export class CronModule {}
