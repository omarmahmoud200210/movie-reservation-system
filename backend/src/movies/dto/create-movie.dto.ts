import {
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMovieDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  description: string;

  /** Runtime in minutes; used to derive screening end times. */
  @IsInt()
  @Min(1)
  duration: number;

  @IsString()
  @MinLength(1)
  posterImgUrl: string;

  @IsString()
  @MinLength(1)
  movieType: string;

  @IsNumber()
  @Min(0)
  @Max(10)
  rating: number;

  @IsString()
  @MinLength(1)
  language: string;

  @IsString()
  @MinLength(1)
  genre: string;
}
