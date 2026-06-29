import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { MoviesService } from './movies.service';

/**
 * Admin movie authoring. Every route is `ADMIN`-only. Public browse/detail
 * lives on a separate controller (Phase 4). Routes carry their own paths so
 * `GET /admin/movies` can coexist with the `/movies` writes.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MoviesAdminController {
  constructor(private readonly moviesService: MoviesService) {}

  @Post('movies')
  create(@Body() dto: CreateMovieDto) {
    return this.moviesService.createMovie(dto);
  }

  @Patch('movies/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMovieDto) {
    return this.moviesService.updateMovie(id, dto);
  }

  @Patch('movies/:id/publish')
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.publish(id);
  }

  @Patch('movies/:id/unpublish')
  unpublish(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.unpublish(id);
  }

  @Delete('movies/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.deleteMovie(id);
  }

  @Get('admin/movies')
  listAll() {
    return this.moviesService.listAllForAdmin();
  }
}
