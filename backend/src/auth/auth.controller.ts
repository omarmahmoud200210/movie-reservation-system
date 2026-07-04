import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import type { AuthUser } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { LoginDto } from './dto/login.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleLinkAuthGuard } from './guards/google-link-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { RefreshUser } from './strategies/jwt-refresh.strategy';
import type { GoogleProfile } from './strategies/google.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.verifyOtp(dto);
    // Auto-login: issue cookies immediately after verification.
    await this.tokenService.issueAuthCookies(res, {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    return user;
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  async login(
    @Body() _dto: LoginDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.tokenService.issueAuthCookies(res, user);
    return user;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  async refresh(
    @CurrentUser() user: RefreshUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fresh = await this.authService.getAuthUser(user.id);
    await this.tokenService.rotateAuthCookies(
      res,
      { id: user.id, jti: user.jti },
      fresh,
    );
    return { message: 'Token refreshed' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  logout(@Res({ passthrough: true }) res: Response) {
    this.tokenService.clearAuthCookies(res);
    return { message: 'Logged out' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /**
   * Kicks off the Google OAuth redirect flow. The browser navigates here
   * directly; GoogleAuthGuard redirects to Google's consent screen.
   */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth(): void {
    // Intentionally empty — the guard handles the redirect to Google.
  }

  /**
   * Google redirects back here. On success we auto-login (issue cookies) and
   * redirect to the frontend; a blocked (manual-account) email redirects to the
   * frontend login page with an error flag so the user can link from settings.
   */
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @CurrentUser() profile: GoogleProfile,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const user = await this.authService.resolveGoogleUser(profile);
      await this.tokenService.issueAuthCookies(res, {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });
      return res.redirect(`${process.env.FRONTEND_URL}/auth/google/callback`);
    } catch (err) {
      if (err instanceof ConflictException) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=account_exists`,
        );
      }
      throw err;
    }
  }

  /**
   * Starts the "link Google from settings" flow. JwtAuthGuard requires a
   * logged-in user; GoogleLinkAuthGuard redirects to Google with the link
   * callback URL so Google returns to /auth/link-google/callback.
   */
  @Get('link-google')
  @UseGuards(JwtAuthGuard, GoogleLinkAuthGuard)
  linkGoogle(): void {
    // Intentionally empty — the guard handles the redirect to Google.
  }

  /**
   * Google redirects here after the link flow. The initiating user is taken
   * from the signed `state` echoed back by Google (CSRF defense — not from an
   * ambient cookie), then the returned googleId is attached. Redirects back to
   * the frontend settings page; a googleId already owned elsewhere redirects
   * with an error flag.
   */
  @Get('link-google/callback')
  @UseGuards(GoogleLinkAuthGuard)
  async linkGoogleCallback(
    @CurrentUser() profile: GoogleProfile,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const query = req.query as { state?: string };
    const { id } = this.tokenService.verifyLinkState(query.state);
    try {
      await this.authService.linkGoogle(id, profile.googleId);
      return res.redirect(`${process.env.FRONTEND_URL}/settings?linked=google`);
    } catch (err) {
      if (err instanceof ConflictException) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/settings?error=google_already_linked`,
        );
      }
      throw err;
    }
  }
}
