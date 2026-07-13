const stripeModule = jest.requireActual('stripe');
const ActualStripe = stripeModule.default ?? stripeModule;

/**
 * Subclasses the real Stripe SDK so `webhooks.constructEvent` (pure HMAC
 * signature verification, no network call) keeps running for real — only
 * the methods that would actually reach Stripe's API are stubbed.
 */
class MockStripe extends ActualStripe {
  checkout = {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  };
  refunds = { create: jest.fn() };
}

export default MockStripe;
