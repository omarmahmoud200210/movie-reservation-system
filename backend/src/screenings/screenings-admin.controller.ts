import {
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateScreeningDto } from './dto/create-screening.dto';
import { UpdateScreeningDto } from './dto/update-screening.dto';
import { ScreeningsService } from './screenings.service';

/**
 * Admin screening scheduling. Every route is `ADMIN`-only. Public screening
 * detail + seat-map reads live on a separate controller (Phase 4).
 */
@Controller('screenings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ScreeningsAdminController {
  constructor(private readonly screeningsService: ScreeningsService) {}

  @Post()
  create(@Body() dto: CreateScreeningDto) {
    return this.screeningsService.createScreening(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScreeningDto,
  ) {
    return this.screeningsService.updateScreening(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.screeningsService.cancelScreening(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.screeningsService.deleteScreening(id);
  }
}
