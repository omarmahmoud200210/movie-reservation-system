import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { AuthUser, AccessPayload } from '../token.service';
import { TokenService } from '../token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly tokenService: TokenService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string> | undefined)?.access_token ??
          null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    const currentVersion = await this.tokenService.getAccessVersion(payload.sub);
    if (payload.ver < currentVersion) {
      throw new UnauthorizedException('Token revoked — please log in again');
    }
    return { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
  }
}
