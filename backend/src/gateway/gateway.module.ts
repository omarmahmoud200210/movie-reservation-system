import { Module } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ScreeningGateway } from './screening.gateway';
import { ReservationBroadcastListener } from './reservation-broadcast.listener';

/**
 * Real-time seat-updates gateway. Imports ScreeningsModule for the seat map +
 * summary reads used by `join:screening` and the broadcast listener.
 * `EventEmitterModule` is global, so no explicit import for the listener.
 * Public/read-only — no auth module needed this phase.
 */
@Module({
  imports: [ScreeningsModule],
  providers: [ScreeningGateway, ReservationBroadcastListener],
  exports: [ScreeningGateway],
})
export class GatewayModule {}
