import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { UserRole } from '@prisma/client';
import type { AuthUser, AccessPayload } from '../token.service';
import { TokenService } from '../token.service';
import { authEnv } from '../auth-env.config';

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
      secretOrKey: authEnv.jwtAccessSecret,
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    const currentVersion = await this.tokenService.getAccessVersion(
      payload.sub,
    );
    if (payload.ver < currentVersion) {
      throw new UnauthorizedException('Token revoked — please log in again');
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role as UserRole,
      name: payload.name,
    };
  }
}
