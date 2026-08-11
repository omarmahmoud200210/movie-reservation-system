/**
 * Auth environment configuration — validated at startup.
 *
 * Import this object instead of using process.env directly.
 * If any required variable is missing or invalid, the app
 * crashes immediately with a descriptive error rather than
 * silently running with broken security.
 */

import 'dotenv/config';

// ─── helpers ────────────────────────────────────────────────

function requireString(name: string, fallback?: string): string {
  const value =
    process.env[name] ??
    (process.env.NODE_ENV === 'test' ? fallback : undefined);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requirePositiveInt(name: string, fallback?: number): number {
  const raw =
    process.env[name] ??
    (process.env.NODE_ENV === 'test' && fallback !== undefined
      ? String(fallback)
      : undefined);
  if (!raw) {
    throw new Error(`Missing required env var: ${name}`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Env var ${name} must be a positive integer, got: "${raw}"`,
    );
  }
  return parsed;
}

// ─── validated config ───────────────────────────────────────

export const authEnv = {
  // JWT
  jwtAccessSecret: requireString('JWT_ACCESS_SECRET', 'test_access_secret'),
  jwtAccessExpiresIn: requireString('JWT_ACCESS_EXPIRES_IN', '15m'),
  jwtRefreshSecret: requireString('JWT_REFRESH_SECRET', 'test_refresh_secret'),
  jwtRefreshExpiresIn: requireString('JWT_REFRESH_EXPIRES_IN', '7d'),

  // OAuth state nonce
  linkStateSecret: requireString('LINK_STATE_SECRET', 'test_link_state_secret'),

  // Cookies
  cookieDomain: requireString('COOKIE_DOMAIN', 'localhost'),
  nodeEnv: requireString('NODE_ENV', 'test'),

  // Google OAuth
  googleClientId: requireString('GOOGLE_CLIENT_ID', 'test_google_client_id'),
  googleClientSecret: requireString(
    'GOOGLE_CLIENT_SECRET',
    'test_google_client_secret',
  ),
  googleCallbackUrl: requireString(
    'GOOGLE_CALLBACK_URL',
    'http://localhost:3000/api/v1/auth/google/callback',
  ),
  googleLinkCallbackUrl: requireString(
    'GOOGLE_LINK_CALLBACK_URL',
    'http://localhost:3000/api/v1/auth/link-google/callback',
  ),

  // OTP
  otpTtlSeconds: requirePositiveInt('OTP_TTL_SECONDS', 600),
  otpMaxAttempts: requirePositiveInt('OTP_MAX_ATTEMPTS', 5),
  otpResendCooldownSeconds: requirePositiveInt(
    'OTP_RESEND_COOLDOWN_SECONDS',
    60,
  ),

  // App URLs
  frontendUrl: requireString('FRONTEND_URL', 'http://localhost:5173'),
} as const;
