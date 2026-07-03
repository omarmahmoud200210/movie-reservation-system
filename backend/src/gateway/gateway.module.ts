import { Module } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ScreeningGateway } from './screening.gateway';

/**
 * Real-time seat-updates gateway. Imports ScreeningsModule for the seat map +
 * summary reads used by `join:screening` and the broadcast listener (added in
 * a later task). Public/read-only — no auth module needed this phase.
 */
@Module({
  imports: [ScreeningsModule],
  providers: [ScreeningGateway],
  exports: [ScreeningGateway],
})
export class GatewayModule {}
