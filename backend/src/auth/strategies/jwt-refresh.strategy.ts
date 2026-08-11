import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { RefreshPayload } from '../token.service';
import { authEnv } from '../auth-env.config';

export interface RefreshUser {
  id: number;
  jti: string;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string> | undefined)?.refresh_token ??
          null,
      ]),
      ignoreExpiration: false,
      secretOrKey: authEnv.jwtRefreshSecret,
    });
  }

  validate(payload: RefreshPayload): RefreshUser {
    return { id: payload.sub, jti: payload.jti };
  }
}
