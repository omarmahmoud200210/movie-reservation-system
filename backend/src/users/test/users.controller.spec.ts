import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from '../users.controller';
import { UsersService } from '../users.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RATE_LIMIT_KEY } from '../../common/decorators/rate-limit.decorator';
import RateLimiterService from '../../redis/rate-limiter.service';

const mockService = {
  updateName: jest.fn(),
  requestEmailChange: jest.fn(),
  confirmEmailChange: jest.fn(),
  getPendingEmailChange: jest.fn(),
  changePassword: jest.fn(),
};

const mockRateLimiterService = {
  rateLimiter: jest.fn().mockResolvedValue({ allowed: true, remaining: 2, resetAfterMs: 60000 }),
};

const GUARDS_METADATA = '__guards__';
const user = { id: 7, email: 'a@b.c', role: 'USER', name: 'A' };
const res = {} as never;

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockService },
        { provide: RateLimiterService, useValue: mockRateLimiterService },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('delegation', () => {
    it('updateName -> service.updateName with the caller id and dto', async () => {
      mockService.updateName.mockResolvedValue(user);

      await controller.updateName(user as never, { name: 'New Name' });

      expect(mockService.updateName).toHaveBeenCalledWith(7, 'New Name');
    });

    it('requestEmailChange -> service.requestEmailChange with the caller id and dto fields', async () => {
      mockService.requestEmailChange.mockResolvedValue({ message: 'ok' });

      await controller.requestEmailChange(user as never, {
        newEmail: 'new@example.com',
        currentPassword: 'current',
      });

      expect(mockService.requestEmailChange).toHaveBeenCalledWith(
        7,
        'new@example.com',
        'current',
      );
    });

    it('confirmEmailChange -> service.confirmEmailChange with the caller id and code', async () => {
      mockService.confirmEmailChange.mockResolvedValue(user);

      await controller.confirmEmailChange(user as never, { code: '123456' });

      expect(mockService.confirmEmailChange).toHaveBeenCalledWith(7, '123456');
    });

    it('getPendingEmailChange -> service.getPendingEmailChange with the caller id', async () => {
      mockService.getPendingEmailChange.mockResolvedValue({ pending: false });

      await controller.getPendingEmailChange(user as never);

      expect(mockService.getPendingEmailChange).toHaveBeenCalledWith(7);
    });

    it('changePassword -> service.changePassword with the caller id, dto fields, and response', async () => {
      mockService.changePassword.mockResolvedValue(undefined);

      await controller.changePassword(
        user as never,
        { currentPassword: 'current', newPassword: 'newpassword' },
        res,
      );

      expect(mockService.changePassword).toHaveBeenCalledWith(
        7,
        'current',
        'newpassword',
        res,
      );
    });
  });

  describe('guard wiring (class-level)', () => {
    it('guards the whole controller with JwtAuthGuard and RateLimitGuard', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, UsersController);
      expect(guards).toEqual([JwtAuthGuard, RateLimitGuard]);
    });
  });

  describe('rate limit wiring (per-route)', () => {
    it('updateName has users:name rate limit metadata', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.updateName,
      );
      expect(meta).toEqual({ points: 10, duration: 3_600_000, key: 'users:name' });
    });

    it('requestEmailChange has users:email-request rate limit metadata', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.requestEmailChange,
      );
      expect(meta).toEqual({ points: 10, duration: 3_600_000, key: 'users:email-request' });
    });

    it('confirmEmailChange has users:email-confirm rate limit metadata', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.confirmEmailChange,
      );
      expect(meta).toEqual({ points: 10, duration: 3_600_000, key: 'users:email-confirm' });
    });

    it('getPendingEmailChange has users:email-pending rate limit metadata', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.getPendingEmailChange,
      );
      expect(meta).toEqual({ points: 10, duration: 3_600_000, key: 'users:email-pending' });
    });

    it('changePassword has users:password rate limit metadata', () => {
      const meta = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.changePassword,
      );
      expect(meta).toEqual({ points: 10, duration: 3_600_000, key: 'users:password' });
    });
  });
});
