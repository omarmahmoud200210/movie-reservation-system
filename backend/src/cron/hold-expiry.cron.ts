import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservationsService } from '../reservations/reservations.service';

/**
 * Releases HELD reservations whose 10-minute hold has expired, every minute.
 * The try/catch here is purely for log visibility, not correctness: the
 * underlying `cron` package already catches a thrown/rejected tick and keeps
 * the schedule running regardless (verified against its source) — without
 * this, a failure would still be harmless but invisible to NestJS's
 * structured Logger (the library's own fallback is a raw console.error).
 */
@Injectable()
export class HoldExpiryCron {
  private readonly logger = new Logger(HoldExpiryCron.name);

  constructor(private readonly reservationsService: ReservationsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpireHolds(): Promise<void> {
    try {
      await this.reservationsService.expireHolds();
    } catch (err) {
      this.logger.error('expireHolds tick failed', err as Error);
    }
  }

  // DEFERRED(phase-9): a payment-reconciliation cron job goes here once the
  // Payments module exists (finds timed_out payments, reconciles with Stripe).
}
