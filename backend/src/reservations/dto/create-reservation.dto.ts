import { ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

export class CreateReservationDto {
  @IsInt()
  @Min(1)
  screeningId: number;

  /** One or more seat ids to hold, all-or-nothing. Deduped in the service. */
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  seatIds: number[];
}
