import { IsInt, Min } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsInt()
  @Min(1)
  reservationId: number;
}
