import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { authEnv } from '../auth-env.config';
import validate, { GoogleProfile } from '../util/google.profile.util';

/**
 * Separate Google strategy used only for the "link from settings" flow. It has
 * its own callback URL so Google redirects to `/auth/link-google/callback`,
 * which is what tells us to LINK (not LOGIN). Logic mirrors GoogleStrategy.
 */
@Injectable()
export class GoogleLinkStrategy extends PassportStrategy(
  Strategy,
  'google-link',
) {
  constructor() {
    super({
      clientID: authEnv.googleClientId,
      clientSecret: authEnv.googleClientSecret,
      callbackURL: authEnv.googleLinkCallbackUrl,
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
