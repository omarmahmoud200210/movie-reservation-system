# Real (non-mocked) Stripe e2e test

## Problem

`backend/test/payments.e2e-spec.ts` exercises the whole payments flow against a manual mock
(`backend/__mocks__/stripe.ts`) that stubs `checkout.sessions.create/retrieve` and
`refunds.create`, while `webhooks.constructEvent` runs for real against locally-signed fixture
payloads. That's the right default for a fast, deterministic suite, but nothing currently proves
the app works against Stripe's actual test-mode API and a genuinely Stripe-issued webhook.

## Scope

One new opt-in test: create a real checkout session via the real Stripe API, relay a real
Stripe-issued `checkout.session.completed` webhook event to the running app via the Stripe CLI,
and assert the reservation ends up `CONFIRMED` with a `seat:booked` broadcast — the same outcome
`payments.e2e-spec.ts` already proves against the mock, but through the real path once.

Not in scope: mirroring every mocked payments test case against live Stripe (redundant, slower,
flakier for no extra signal), refund-via-live-Stripe, CI wiring — this is a local, opt-in,
manually-run check.

## Design

**Why not complete the session for real:** Checkout Sessions are Stripe-hosted pages; there is no
API call that flips one to "paid" as if a customer entered a card. Completing one for real needs
either browser automation against Stripe's hosted checkout page, or the approach below.

**Chosen mechanism — `stripe listen` + `stripe trigger`:**
1. Test creates a checkout session through the real, unmocked `PaymentsService` (real API call to
   Stripe's test-mode API) — this yields a real session id and, per the app's existing code,
   stores `metadata.paymentId` on the session.
2. Test spawns `stripe listen --forward-to localhost:<port>/api/v1/payments/webhook --api-key
   <key>` as a child process. This is a *real* Stripe CLI process forwarding *real* webhook
   deliveries (real HTTP request, real `stripe-signature` header, real HMAC) to the running app.
   `stripe listen` prints its own webhook signing secret to stdout on startup
   (`Ready! Your webhook signing secret is whsec_...`) — the test parses that line and sets
   `process.env.STRIPE_WEBHOOK_SECRET` to it before triggering anything, since that secret is
   generated per-CLI-session and isn't the account's dashboard secret.
3. Test spawns `stripe trigger checkout.session.completed --override
   checkout_session:metadata.paymentId=<id>`. This creates fixture Stripe objects on the real test
   account and emits a real `checkout.session.completed` event, which `stripe listen` relays to the
   app exactly like a production webhook delivery would.
4. Test asserts: webhook endpoint responds `201`, the reservation transitions to `CONFIRMED`, and a
   `seat:booked` event broadcasts over the screening room socket — mirroring the existing mocked
   assertion in `payments.e2e-spec.ts`.

**Unverified assumption — spike this first:** whether `--override
checkout_session:metadata.paymentId=<id>` actually threads through to the relayed event's
`data.object.metadata`. If it doesn't, `PaymentsService.paymentIdFrom()` can't resolve which
payment to confirm and the whole approach needs a different way to correlate the triggered event
back to the test's session (e.g., matching on session id instead of metadata, if `stripe trigger`
preserves that). This must be confirmed empirically before writing the rest of the test — see
Task 1 of the implementation plan.

**Files:**
- `backend/test/stripe-live.e2e-spec.ts` (new) — the test itself. Starts with `jest.unmock('stripe')`
  so `PaymentsService`'s `new Stripe(...)` gets the real SDK, not `__mocks__/stripe.ts` (Jest
  auto-applies adjacent-to-node_modules manual mocks to every test file unless unmocked).
- `backend/test/support/stripe-cli.ts` (new) — spawns/parses `stripe listen`, exposes
  `startWebhookRelay(port, apiKey)` returning `{ webhookSecret, stop() }`, and `triggerCheckoutCompleted(paymentId, apiKey)` wrapping `stripe trigger ... --override ...`.
- `backend/test/jest-e2e-stripe-live.json` (new) — separate Jest config. Same `globalSetup`/
  `globalTeardown` as the default e2e config (still needs the Testcontainers Postgres/Redis), but
  its own `setupFiles` chain: `.env.test` → `.env.test.runtime` (Testcontainers ports) →
  `.env.test.stripe-live` (real key, loaded last with `override: true`).
- `backend/.env.test.stripe-live` (new, gitignored, not created by this plan — the user supplies
  their own real `sk_test_...` key locally): `STRIPE_SECRET_KEY=sk_test_...`.
- `backend/test/jest-e2e.json` (edit) — `testRegex` gets a negative lookahead so the default suite
  never picks up `stripe-live.e2e-spec.ts`:
  `"test/(?!stripe-live\\.e2e-spec).*\\.e2e-spec\\.ts$"`.
- `backend/package.json` (edit) — new script:
  `"test:e2e:stripe-live": "jest --config ./test/jest-e2e-stripe-live.json --runInBand"`.
- `.gitignore` (edit) — add `backend/.env.test.stripe-live`.

**Prerequisites (documented in the spec file's own header comment, not automated):** Stripe CLI
installed (confirmed present locally: 1.43.6) and authenticated, or the real key passed explicitly
via `--api-key` (this design always passes `--api-key` explicitly, so `stripe login` isn't
required); `backend/.env.test.stripe-live` populated with a real Stripe test-mode secret key. If
either is missing, the test should fail with a clear, specific error message (not a cryptic
timeout) — the plan's tasks must cover this.

## Out of scope

- CI wiring (no secrets management story here; this stays a manual/local check).
- Refund-via-live-Stripe, dispute events, or any other webhook type through the live path — only
  `checkout.session.completed`.
- Browser-automation-based checkout completion (rejected above in favor of the CLI relay).
