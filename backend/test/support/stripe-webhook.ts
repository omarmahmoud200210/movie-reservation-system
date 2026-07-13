const stripeModule = jest.requireActual('stripe');
const ActualStripe = stripeModule.default ?? stripeModule;

/** Signs a payload with the real Stripe webhook-signing scheme against the
 * fixed STRIPE_WEBHOOK_SECRET in .env.test, so PaymentsService's real
 * `stripe.webhooks.constructEvent` signature check passes/fails exactly
 * like it would against a real webhook from Stripe. */
export function signWebhookPayload(payload: object): { body: Buffer; signature: string } {
  const body = Buffer.from(JSON.stringify(payload));
  const signature: string = ActualStripe.webhooks.generateTestHeaderString({
    payload: body.toString(),
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  });
  return { body, signature };
}
