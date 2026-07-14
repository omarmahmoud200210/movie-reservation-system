import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const STRIPE_LIVE_ENV_PATH = path.resolve(__dirname, '../.env.test.stripe-live');

if (!fs.existsSync(STRIPE_LIVE_ENV_PATH)) {
  throw new Error(
    `Missing ${STRIPE_LIVE_ENV_PATH}. This file must contain a real Stripe test-mode secret key ` +
      `(STRIPE_SECRET_KEY=sk_test_...) to run test:e2e:stripe-live. See ` +
      `docs/superpowers/plans/2026-07-15-stripe-live-testing.md for setup.`,
  );
}

dotenv.config({ path: STRIPE_LIVE_ENV_PATH, override: true });

if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error(
    `${STRIPE_LIVE_ENV_PATH} must set STRIPE_SECRET_KEY to a real Stripe test-mode secret key ` +
      `(starting with sk_test_), got: ${process.env.STRIPE_SECRET_KEY ?? '(unset)'}`,
  );
}