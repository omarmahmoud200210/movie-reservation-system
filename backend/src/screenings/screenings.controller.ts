import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ScreeningsService } from './screenings.service';

/**
 * Public screening reads — detail, seat map, and a movie's upcoming
 * screenings. No guards: these back the booking/selection UI. Routes carry
 * their own paths since they span `/screenings` and `/movies`.
 */
@Controller()
export class ScreeningsController {
  constructor(private readonly screeningsService: ScreeningsService) {}

  @Get('movies/:id/screenings')
  movieScreenings(@Param('id', ParseIntPipe) id: number) {
    return this.screeningsService.getMovieScreenings(id);
  }

  @Get('screenings/:id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.screeningsService.getScreeningDetail(id);
  }

  @Get('screenings/:id/seats')
  seats(@Param('id', ParseIntPipe) id: number) {
    return this.screeningsService.getSeatMap(id);
  }
}
