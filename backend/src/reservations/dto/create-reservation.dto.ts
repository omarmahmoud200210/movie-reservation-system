import { IsInt, Min } from 'class-validator';

export class CreateReservationDto {
  @IsInt()
  @Min(1)
  screeningId: number;

  @IsInt()
  @Min(1)
  seatId: number;
}
