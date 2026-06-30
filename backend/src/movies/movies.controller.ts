import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { MoviesService } from './movies.service';

/**
 * Public movie reads — browse (now-showing / coming-soon) and detail.
 * No guards: published catalog is public. Drafts are invisible here.
 */
@Controller('movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Get()
  browse() {
    return this.moviesService.browseMovies();
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.getPublishedMovie(id);
  }
}
