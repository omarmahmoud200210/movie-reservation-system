import { Module, forwardRef } from '@nestjs/common';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';

@Module({
  imports: [ScreeningsModule, forwardRef(() => ReservationsModule)],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService],
})
export class PaymentsModule {}
