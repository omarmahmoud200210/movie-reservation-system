import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/token.service';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { PaymentsService } from './payments.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ points: 5, duration: 60_000, key: 'payments:checkout' })
  @Post('checkout-session')
  createCheckoutSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.paymentsService.createCheckoutSession(
      user.id,
      dto.reservationId,
    );
  }

  @Post('webhook')
  handleWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.paymentsService.handleWebhookEvent(
      req.rawBody as Buffer,
      req.headers['stripe-signature'] as string,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('reservations/:reservationId/status')
  getStatus(
    @CurrentUser() user: AuthUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.paymentsService.getStatus(user.id, reservationId);
  }
}
