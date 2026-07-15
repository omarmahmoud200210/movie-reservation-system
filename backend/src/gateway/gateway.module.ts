import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ScreeningGateway } from './screening.gateway';
import { ReservationBroadcastListener } from './reservation-broadcast.listener';

/**
 * Real-time seat-updates gateway. Imports ScreeningsModule for the seat map +
 * summary reads used by `join:screening` and the broadcast listener.
 * `EventEmitterModule` is global, so no explicit import for the listener.
 * Connections optionally attach JWT identity for per-holder notifications,
 * but remain unauthenticated/public by default (no guard added, connection
 * never rejected for missing/bad auth).
 */
@Module({
  imports: [ScreeningsModule, JwtModule.register({})],
  providers: [ScreeningGateway, ReservationBroadcastListener],
  exports: [ScreeningGateway],
})
export class GatewayModule {}
