import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from '../payments.controller';
import { PaymentsService } from '../payments.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RATE_LIMIT_KEY } from '../../common/decorators/rate-limit.decorator';
import RateLimiterService from '../../redis/rate-limiter.service';

const mockService = {
  createCheckoutSession: jest.fn(),
  handleWebhookEvent: jest.fn(),
  getStatus: jest.fn(),
};
const mockRateLimiterService = {
  rateLimiter: jest
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 2, resetAfterMs: 60000 }),
};
const user = { id: 7, email: 'a@b.c', role: 'USER', name: 'A' };
const GUARDS_METADATA = '__guards__';

describe('PaymentsController', () => {
  let controller: PaymentsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockService },
        { provide: RateLimiterService, useValue: mockRateLimiterService },
      ],
    }).compile();
    controller = module.get<PaymentsController>(PaymentsController);
  });

  describe('delegation', () => {
    it('createCheckoutSession -> service with caller id and reservationId', async () => {
      mockService.createCheckoutSession.mockResolvedValue({
        url: 'https://x',
      });

      await controller.createCheckoutSession(user as never, {
        reservationId: 100,
      });

      expect(mockService.createCheckoutSession).toHaveBeenCalledWith(7, 100);
    });

    it('handleWebhook -> service with raw body and signature header', async () => {
      const req = {
        rawBody: Buffer.from('{}'),
        headers: { 'stripe-signature': 'sig_1', 'content-type': 'application/json' },
      } as never;
      mockService.handleWebhookEvent.mockResolvedValue({ received: true });

      await controller.handleWebhook(req);

      expect(mockService.handleWebhookEvent).toHaveBeenCalledWith(
        Buffer.from('{}'),
        'sig_1',
      );
    });

    it('getStatus -> service with caller id and reservationId', async () => {
      mockService.getStatus.mockResolvedValue({
        reservationStatus: 'HELD',
        paymentStatus: null,
      });

      await controller.getStatus(user as never, 100);

      expect(mockService.getStatus).toHaveBeenCalledWith(7, 100);
    });
  });

  describe('rate limit wiring (checkout-session)', () => {
    it('applies RateLimitGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        PaymentsController.prototype.createCheckoutSession,
      );
      expect(guards).toEqual([JwtAuthGuard, RateLimitGuard]);
    });

    it('sets rate-limit metadata: 5/1min, payments:checkout', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        PaymentsController.prototype.createCheckoutSession,
      );
      expect(meta).toEqual({
        points: 5,
        duration: 60_000,
        key: 'payments:checkout',
      });
    });
  });
});
