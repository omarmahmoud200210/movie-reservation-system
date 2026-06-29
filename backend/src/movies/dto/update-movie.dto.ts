import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Partial of {@link CreateMovieDto}. Written out explicitly (rather than
 * `PartialType`) so the module stays free of `@nestjs/mapped-types`.
 * `status` is intentionally absent — transitions go through publish/unpublish.
 */
export class UpdateMovieDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  posterImgUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  movieType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  rating?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  language?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  genre?: string;
}
