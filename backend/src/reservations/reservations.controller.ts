import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/token.service';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

/**
 * Authenticated seat reservations. The caller identity always comes from the
 * JWT (`@CurrentUser()`), never from the request body.
 */
@Controller('reservations')
@UseGuards(JwtAuthGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  // DEFERRED(phase-8): per-user rate limit (3 / 1 min) on this route.
  @Post()
  reserve(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservationsService.reserve(user.id, dto);
  }

  @Get('me')
  listMine(@CurrentUser() user: AuthUser) {
    return this.reservationsService.listMine(user.id);
  }

  @Delete(':id')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.reservationsService.cancel(user.id, id);
  }
}
