import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users.service';
import { UsersRepository } from '../users.repository';
import RedisCache from '../../redis/redis.cache';
import { OtpService } from '../../auth/otp.service';
import { MailerService } from '../../mailer/mailer.service';
import { AuthService } from '../../auth/auth.service';
import { TokenService } from '../../auth/token.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const mockRepo = {
  findById: jest.fn(),
  findByEmail: jest.fn(),
  updateName: jest.fn(),
  updateEmail: jest.fn(),
  updatePassword: jest.fn(),
};
const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
const mockOtp = { issue: jest.fn(), verify: jest.fn() };
const mockMailer = { sendOtpEmail: jest.fn() };
const mockAuthService = { getAuthUser: jest.fn() };
const mockTokenService = {
  revokeAllSessions: jest.fn(),
  issueAuthCookies: jest.fn(),
};
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.OTP_TTL_SECONDS = '300';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: mockRepo },
        { provide: RedisCache, useValue: mockRedis },
        { provide: OtpService, useValue: mockOtp },
        { provide: MailerService, useValue: mockMailer },
        { provide: AuthService, useValue: mockAuthService },
        { provide: TokenService, useValue: mockTokenService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  const authUser = { id: 1, name: 'Jane', email: 'jane@example.com', role: 'USER' };

  describe('updateName', () => {
    it('updates via the repo, then returns the fresh AuthUser', async () => {
      mockRepo.updateName.mockResolvedValue({});
      mockAuthService.getAuthUser.mockResolvedValue(authUser);

      const result = await service.updateName(1, 'Jane');

      expect(mockRepo.updateName).toHaveBeenCalledWith(1, 'Jane');
      expect(mockAuthService.getAuthUser).toHaveBeenCalledWith(1);
      expect(result).toEqual(authUser);
    });
  });

  describe('requestEmailChange', () => {
    const user = { id: 1, password: 'hashed' };

    it('throws 401 when the account has no password (Google-only)', async () => {
      mockRepo.findById.mockResolvedValue({ ...user, password: null });

      await expect(
        service.requestEmailChange(1, 'new@example.com', 'current'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockRepo.findByEmail).not.toHaveBeenCalled();
    });

    it('throws 401 when the current password is wrong', async () => {
      mockRepo.findById.mockResolvedValue(user);
      mockBcrypt.compare.mockResolvedValue(false as never);

      await expect(
        service.requestEmailChange(1, 'new@example.com', 'wrong'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 409 when the new email is already registered', async () => {
      mockRepo.findById.mockResolvedValue(user);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockRepo.findByEmail.mockResolvedValue({ id: 2 });

      await expect(
        service.requestEmailChange(1, 'taken@example.com', 'current'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('on success, stores the pending email in redis and sends an OTP to the new address', async () => {
      mockRepo.findById.mockResolvedValue(user);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockRepo.findByEmail.mockResolvedValue(null);
      mockOtp.issue.mockResolvedValue('123456');

      const result = await service.requestEmailChange(1, 'new@example.com', 'current');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'pending_email:1',
        'new@example.com',
        'EX',
        300,
      );
      expect(mockOtp.issue).toHaveBeenCalledWith('new@example.com');
      expect(mockMailer.sendOtpEmail).toHaveBeenCalledWith('new@example.com', '123456');
      expect(result).toEqual({ message: 'Verification code sent to new email' });
    });
  });
});
