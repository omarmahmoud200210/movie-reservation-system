import { IsDateString, IsInt, Min } from 'class-validator';

export class CreateScreeningDto {
  @IsInt()
  @Min(1)
  movieId: number;

  @IsInt()
  @Min(1)
  hallId: number;

  /** ISO 8601 datetime. End time is derived as startTime + movie.duration. */
  @IsDateString()
  startTime: string;

  /** Fixed ticket price for the screening (per-seat pricing is deferred). */
  @IsInt()
  @Min(0)
  price: number;
}
