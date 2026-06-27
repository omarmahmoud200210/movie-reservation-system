import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { TokenService } from '../token.service';
import type { AuthUser } from '../token.service';

@Injectable()
export class GoogleLinkAuthGuard extends AuthGuard('google-link') {
  constructor(private readonly tokenService: TokenService) {
    super();
  }

  /**
   * On the initiation leg, inject a signed `state` bound to the logged-in user
   * (set by JwtAuthGuard, which runs first). Google echoes it back to the
   * callback, where it is verified — this is the CSRF defense for linking.
   *
   * This guard also runs on the callback leg, where there is no req.user; there
   * the returned state is unused (passport reads it from the query), so we
   * return no options rather than dereferencing a missing user.
   */
  getAuthenticateOptions(context: ExecutionContext): { state?: string } {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as AuthUser | undefined;
    if (!user) return {};
    return { state: this.tokenService.signLinkState(user.id) };
  }
}
