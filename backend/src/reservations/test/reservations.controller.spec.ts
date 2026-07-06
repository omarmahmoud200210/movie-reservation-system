import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsController } from '../reservations.controller';
import { ReservationsService } from '../reservations.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RATE_LIMIT_KEY } from '../../common/decorators/rate-limit.decorator';
import RateLimiterService from '../../redis/rate-limiter.service';

const mockService = {
  reserve: jest.fn(),
  cancel: jest.fn(),
  listMine: jest.fn(),
};

const mockRateLimiterService = {
  rateLimiter: jest.fn().mockResolvedValue({ allowed: true, remaining: 2, resetAfterMs: 60000 }),
};

const GUARDS_METADATA = '__guards__';
const user = { id: 7, email: 'a@b.c', role: 'USER', name: 'A' };

describe('ReservationsController', () => {
  let controller: ReservationsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [
        { provide: ReservationsService, useValue: mockService },
        { provide: RateLimiterService, useValue: mockRateLimiterService },
      ],
    }).compile();

    controller = module.get<ReservationsController>(ReservationsController);
  });

  describe('delegation', () => {
    it('reserve -> service.reserve with the caller id and dto', async () => {
      const dto = { screeningId: 3, seatIds: [11, 12] };
      mockService.reserve.mockResolvedValue([{ id: 100 }]);

      await controller.reserve(user as never, dto);

      expect(mockService.reserve).toHaveBeenCalledWith(7, dto);
    });

    it('listMine -> service.listMine with the caller id', async () => {
      mockService.listMine.mockResolvedValue([]);

      await controller.listMine(user as never);

      expect(mockService.listMine).toHaveBeenCalledWith(7);
    });

    it('cancel -> service.cancel with the caller id and reservation id', async () => {
      mockService.cancel.mockResolvedValue({ id: 100 });

      await controller.cancel(user as never, 100);

      expect(mockService.cancel).toHaveBeenCalledWith(7, 100);
    });
  });

  describe('guard wiring (class-level)', () => {
    it('guards the whole controller with JwtAuthGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        ReservationsController,
      );
      expect(guards).toEqual([JwtAuthGuard]);
    });
  });

  describe('rate limit wiring (method-level, reserve)', () => {
    it('applies RateLimitGuard on reserve()', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        ReservationsController.prototype.reserve,
      );
      expect(guards).toEqual([RateLimitGuard]);
    });

    it('sets rate-limit metadata on reserve()', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        ReservationsController.prototype.reserve,
      );
      expect(meta).toEqual({ points: 3, duration: 60_000, key: 'reservations:create' });
    });
  });
});
