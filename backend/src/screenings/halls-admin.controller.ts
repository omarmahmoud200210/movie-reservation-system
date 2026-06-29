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
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateHallDto } from './dto/create-hall.dto';
import { HallsService } from './halls.service';

/**
 * Hall management. Writes + the full-hall listing are `ADMIN`-only;
 * `GET /halls/:id` is public (used by the seat-picking UI).
 */
@Controller('halls')
export class HallsAdminController {
  constructor(private readonly hallsService: HallsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateHallDto) {
    return this.hallsService.createHall(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  list() {
    return this.hallsService.listHalls();
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.hallsService.getHall(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.hallsService.deleteHall(id);
  }
}
