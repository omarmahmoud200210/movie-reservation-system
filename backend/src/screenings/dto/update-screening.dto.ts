import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Partial of {@link CreateScreeningDto}, written out explicitly to stay free of
 * `@nestjs/mapped-types`. `status` is intentionally absent — transitions go
 * through the cancel endpoint.
 */
export class UpdateScreeningDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  movieId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  hallId?: number;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;
}
