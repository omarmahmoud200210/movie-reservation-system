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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../common/services/audit.service';
import type { AuthUser } from '../auth/token.service';
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
  constructor(
    private readonly moviesService: MoviesService,
    private readonly audit: AuditService,
  ) {}

  @Post('movies')
  async create(@Body() dto: CreateMovieDto, @CurrentUser() user: AuthUser) {
    const movie = await this.moviesService.createMovie(dto);
    await this.audit.record({ action: 'movie.created', actorId: user.id, targetType: 'movie', targetId: movie.id });
    return movie;
  }

  @Patch('movies/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMovieDto, @CurrentUser() user: AuthUser) {
    const movie = await this.moviesService.updateMovie(id, dto);
    await this.audit.record({ action: 'movie.updated', actorId: user.id, targetType: 'movie', targetId: id });
    return movie;
  }

  @Patch('movies/:id/publish')
  async publish(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const movie = await this.moviesService.publish(id);
    await this.audit.record({ action: 'movie.published', actorId: user.id, targetType: 'movie', targetId: id });
    return movie;
  }

  @Patch('movies/:id/unpublish')
  async unpublish(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const movie = await this.moviesService.unpublish(id);
    await this.audit.record({ action: 'movie.unpublished', actorId: user.id, targetType: 'movie', targetId: id });
    return movie;
  }

  @Delete('movies/:id')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const result = await this.moviesService.deleteMovie(id);
    await this.audit.record({ action: 'movie.deleted', actorId: user.id, targetType: 'movie', targetId: id });
    return result;
  }

  @Get('admin/movies')
  listAll() {
    return this.moviesService.listAllForAdmin();
  }
}
