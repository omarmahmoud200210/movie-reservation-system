import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { GoogleProfile } from './google.strategy';

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
      clientID: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      callbackURL: process.env.GOOGLE_LINK_CALLBACK_URL as string,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new UnauthorizedException('Google account has no email'), false);
      return;
    }
    const user: GoogleProfile = {
      email,
      name: profile.displayName,
      googleId: profile.id,
    };
    done(null, user);
  }
}
