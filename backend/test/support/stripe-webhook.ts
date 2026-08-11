const stripeModule = jest.requireActual('stripe');
const ActualStripe = stripeModule.default ?? stripeModule;

/** Signs a payload with the real Stripe webhook-signing scheme against the
 * fixed STRIPE_WEBHOOK_SECRET in .env.test, so PaymentsService's real
 * `stripe.webhooks.constructEvent` signature check passes/fails exactly
 * like it would against a real webhook from Stripe.
 *
 * Returns `body` as a string, not a Buffer: supertest's `.send()`
 * JSON.stringify's a Buffer argument when the Content-Type is set to
 * application/json (turning it into `{"type":"Buffer","data":[...]}`),
 * which corrupts the raw bytes Stripe's signature covers. A string is sent
 * on the wire byte-for-byte as-is, matching what was signed here. */
export function signWebhookPayload(payload: object): {
  body: string;
  signature: string;
} {
  const body = JSON.stringify(payload);
  const signature: string = ActualStripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  });
  return { body, signature };
}
