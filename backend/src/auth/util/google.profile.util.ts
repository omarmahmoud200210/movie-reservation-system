import { UnauthorizedException } from '@nestjs/common';
import type { Profile, VerifyCallback } from 'passport-google-oauth20';

export interface GoogleProfile {
  email: string;
  name: string;
  googleId: string;
}

export default function validate(
  _accessToken: string,
  _refreshToken: string,
  profile: Profile,
  done: VerifyCallback,
) {
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
