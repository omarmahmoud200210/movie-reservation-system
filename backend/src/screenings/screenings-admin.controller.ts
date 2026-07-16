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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../common/services/audit.service';
import type { AuthUser } from '../auth/token.service';
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
  constructor(
    private readonly screeningsService: ScreeningsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(@Body() dto: CreateScreeningDto, @CurrentUser() user: AuthUser) {
    const screening = await this.screeningsService.createScreening(dto);
    await this.audit.record({ action: 'screening.created', actorId: user.id, targetType: 'screening', targetId: screening.id });
    return screening;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScreeningDto,
    @CurrentUser() user: AuthUser,
  ) {
    const screening = await this.screeningsService.updateScreening(id, dto);
    await this.audit.record({ action: 'screening.updated', actorId: user.id, targetType: 'screening', targetId: id });
    return screening;
  }

  @Patch(':id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const screening = await this.screeningsService.cancelScreening(id);
    await this.audit.record({ action: 'screening.cancelled', actorId: user.id, targetType: 'screening', targetId: id });
    return screening;
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const result = await this.screeningsService.deleteScreening(id);
    await this.audit.record({ action: 'screening.deleted', actorId: user.id, targetType: 'screening', targetId: id });
    return result;
  }
}
