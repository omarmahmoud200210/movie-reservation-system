// backend/test/support/mailer.ts
/**
 * Stub replacing the real MailerService in e2e tests. The real service would
 * attempt an SMTP connection (localhost:2525) that never accepts mail, so
 * register()/resend-otp() would 500. This stub records issued OTP codes so
 * tests can read them without touching SMTP or Redis internals.
 */
export class TestMailerService {
  codes = new Map<string, string>();

  sendOtpEmail(to: string, code: string): void {
    this.codes.set(to, code);
  }

  /** Returns the most recently issued code for an email ('' if none). */
  getOtp(email: string): string {
    return this.codes.get(email) ?? '';
  }
}
