import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateHallDto {
  @IsString()
  @MinLength(1)
  name: string;

  /** Number of seat rows. e.g. 8 → rows A..H */
  @IsInt()
  @Min(1)
  rows: number;

  /** Seats per row. e.g. 12 → numbers 1..12 */
  @IsInt()
  @Min(1)
  seatsPerRow: number;
}
