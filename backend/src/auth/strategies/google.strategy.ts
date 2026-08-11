import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { authEnv } from '../auth-env.config';
import validate from '../util/google.profile.util';

interface arguments {
  _accessToken: string;
  _refreshToken: string;
  profile: Profile;
  done: VerifyCallback;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: authEnv.googleClientId,
      clientSecret: authEnv.googleClientSecret,
      callbackURL: authEnv.googleCallbackUrl,
      scope: ['email', 'profile'],
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    return validate(accessToken, refreshToken, profile, done);
  }
}
