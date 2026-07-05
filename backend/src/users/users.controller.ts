import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/token.service';
import { UsersService } from './users.service';
import { UpdateNameDto } from './dto/update-name.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * Authenticated user-settings actions. The caller identity always comes from
 * the JWT (`@CurrentUser()`), never from the request body.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Patch('me')
  updateName(@CurrentUser() user: AuthUser, @Body() dto: UpdateNameDto) {
    return this.usersService.updateName(user.id, dto.name);
  }

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Post('me/email')
  @HttpCode(HttpStatus.OK)
  requestEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.usersService.requestEmailChange(
      user.id,
      dto.newEmail,
      dto.currentPassword,
    );
  }

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Post('me/email/confirm')
  @HttpCode(HttpStatus.OK)
  confirmEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    return this.usersService.confirmEmailChange(user.id, dto.code);
  }

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Get('me/email/pending')
  getPendingEmailChange(@CurrentUser() user: AuthUser) {
    return this.usersService.getPendingEmailChange(user.id);
  }

  // DEFERRED(phase-8): per-user rate limit on this route (maps to
  // architecture.md's `PUT /user/settings` rule — the most sensitive of the
  // five new routes; confirm exact mapping across all five when Phase 8 is
  // brainstormed).
  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.usersService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      res,
    );
    return { message: 'Password changed' };
  }
}
