import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

// Modules...
import { AuthService } from '../auth.service';
import { AuthRepository } from '../auth.repository';
import { OtpService } from '../otp.service';
import { MailerService } from '../../mailer/mailer.service';
import { AuditService } from '../../common/services/audit.service';
import argon2 from 'argon2';

const mockRepo = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
  findByGoogleId: jest.fn(),
  createUser: jest.fn(),
  createGoogleUser: jest.fn(),
  setGoogleId: jest.fn(),
  markEmailVerified: jest.fn(),
};

// Mock argon2
jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

const mockOtp = { issue: jest.fn(), verify: jest.fn() };
const mockMailer = { sendOtpEmail: jest.fn() };
const mockAudit = { record: jest.fn() };
const mockArgon2 = argon2 as jest.Mocked<typeof argon2>;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: mockRepo },
        { provide: OtpService, useValue: mockOtp },
        { provide: MailerService, useValue: mockMailer },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  const user = {
    id: 1,
    email: '[EMAIL_ADDRESS]',
    password: '[HASHED_PASSWORD]',
    name: 'John Doe',
    emailVerified: false,
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const registerDto = {
    email: '[EMAIL_ADDRESS]',
    password: '[PASSWORD]',
    name: 'John Doe',
  };

  describe('Register', () => {
    it('Should register a new user successfully', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.createUser.mockResolvedValue(user);
      mockOtp.issue.mockResolvedValue('123456');

      const result = await service.register(registerDto);

      expect(result).toEqual({
        message: 'If eligible, a verification code was sent',
      });
      expect(mockOtp.issue).toHaveBeenCalledWith(user.email);
      expect(mockMailer.sendOtpEmail).toHaveBeenCalledWith(
        user.email,
        '123456',
      );
    });

    it('If User Already Exist', async () => {
      mockRepo.findByEmail.mockResolvedValue(user);

      const result = await service.register(registerDto);

      expect(result).toEqual({
        message: 'If eligible, a verification code was sent',
      });
      expect(mockRepo.createUser).not.toHaveBeenCalled();
      expect(mockOtp.issue).not.toHaveBeenCalled();
      expect(mockMailer.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('Verify OTP', () => {
    it('Should verify OTP successfully', async () => {
      mockRepo.findByEmail.mockResolvedValue(user);
      mockOtp.verify.mockResolvedValue(true);
      mockRepo.markEmailVerified.mockResolvedValue({
        ...user,
        emailVerified: true,
      });

      const result = await service.verifyOtp({
        email: user.email,
        code: '123456',
      });

      expect(mockOtp.verify).toHaveBeenCalledWith(user.email, '123456');
      expect(mockRepo.markEmailVerified).toHaveBeenCalledWith(user.id);
      expect(result.emailVerified).toBe(true);
    });

    it('Should throw error if user not found', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);

      await expect(
        service.verifyOtp({ email: user.email, code: '123456' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockOtp.verify).not.toHaveBeenCalled();
    });

    it('Should throw error if user already verified', async () => {
      mockRepo.findByEmail.mockResolvedValue({ ...user, emailVerified: true });

      await expect(
        service.verifyOtp({ email: user.email, code: '123456' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockOtp.verify).not.toHaveBeenCalled();
    });

    it('Should throw error if code is incorrect', async () => {
      mockRepo.findByEmail.mockResolvedValue(user);
      mockOtp.verify.mockResolvedValue(false);

      await expect(
        service.verifyOtp({ email: user.email, code: 'wrong' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.markEmailVerified).not.toHaveBeenCalled();
    });
  });

  describe('Resend OTP', () => {
    it('Should resend OTP successfully', async () => {
      mockRepo.findByEmail.mockResolvedValue(user);
      mockOtp.issue.mockResolvedValue('654321');

      const result = await service.resendOtp({ email: user.email });

      expect(result).toEqual({ message: 'Verification code sent' });
      expect(mockOtp.issue).toHaveBeenCalledWith(user.email);
      expect(mockMailer.sendOtpEmail).toHaveBeenCalledWith(
        user.email,
        '654321',
      );
    });

    it('Should return neutral message if user not found', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);

      const result = await service.resendOtp({ email: user.email });

      expect(result).toEqual({ message: 'If eligible, a code was sent' });
      expect(mockOtp.issue).not.toHaveBeenCalled();
      expect(mockMailer.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('Should return neutral message if user already verified', async () => {
      mockRepo.findByEmail.mockResolvedValue({ ...user, emailVerified: true });

      const result = await service.resendOtp({ email: user.email });

      expect(result).toEqual({ message: 'If eligible, a code was sent' });
      expect(mockOtp.issue).not.toHaveBeenCalled();
      expect(mockMailer.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('Validate User', () => {
    const verifiedUser = { ...user, emailVerified: true };
    const expectedAuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    it('Should validate user successfully', async () => {
      mockRepo.findByEmail.mockResolvedValue(verifiedUser);
      mockArgon2.verify.mockResolvedValue(true);

      const result = await service.validateUser(user.email, 'correct');

      expect(result).toEqual(expectedAuthUser);
      expect(mockArgon2.verify).toHaveBeenCalledWith(user.password, 'correct');
    });

    it('Should throw error if user not found', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      await expect(
        service.validateUser(user.email, user.password),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockArgon2.verify).not.toHaveBeenCalled();
    });

    it('Should throw error if the password is wrong', async () => {
      mockRepo.findByEmail.mockResolvedValue(verifiedUser);
      mockArgon2.verify.mockResolvedValue(false);

      await expect(service.validateUser(user.email, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockArgon2.verify).toHaveBeenCalledWith(user.password, 'wrong');
    });

    it('Should throw an error if the user unverified', async () => {
      mockRepo.findByEmail.mockResolvedValue(user); // emailVerified: false
      mockArgon2.verify.mockResolvedValue(true);

      await expect(service.validateUser(user.email, 'correct')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('Resolve Google User', () => {
    const googleProfile = {
      email: user.email,
      name: 'John Doe',
      googleId: 'google-123',
    };

    const expectedAuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    it('Should return the existing google user when googleId is known', async () => {
      const googleUser = { ...user, googleId: 'google-123' };
      mockRepo.findByGoogleId.mockResolvedValue(googleUser);

      const result = await service.resolveGoogleUser(googleProfile);

      expect(result).toEqual(expectedAuthUser);
      expect(mockRepo.findByEmail).not.toHaveBeenCalled();
      expect(mockRepo.createGoogleUser).not.toHaveBeenCalled();
    });

    it('Should create a verified user when the email is brand new', async () => {
      const createdUser = {
        ...user,
        googleId: 'google-123',
        emailVerified: true,
        password: null,
      };
      mockRepo.findByGoogleId.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.createGoogleUser.mockResolvedValue(createdUser);

      const result = await service.resolveGoogleUser(googleProfile);

      expect(result).toEqual(expectedAuthUser);
      expect(mockRepo.createGoogleUser).toHaveBeenCalledWith(googleProfile);
    });

    it('Should block when a manual account already owns the email', async () => {
      mockRepo.findByGoogleId.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(user); // manual account

      await expect(service.resolveGoogleUser(googleProfile)).rejects.toThrow(
        ConflictException,
      );
      expect(mockRepo.createGoogleUser).not.toHaveBeenCalled();
    });
  });

  describe('Link Google', () => {
    const verifiedUser = { ...user, emailVerified: true };

    it('Should set the googleId when it is free', async () => {
      const linked = { ...verifiedUser, googleId: 'google-123' };
      mockRepo.findByGoogleId.mockResolvedValue(null);
      mockRepo.setGoogleId.mockResolvedValue(linked);

      const result = await service.linkGoogle(verifiedUser.id, 'google-123');

      expect(result).toEqual(linked);
      expect(mockRepo.setGoogleId).toHaveBeenCalledWith(
        verifiedUser.id,
        'google-123',
      );
    });

    it('Should block when the googleId is already attached to another user', async () => {
      mockRepo.findByGoogleId.mockResolvedValue({
        ...verifiedUser,
        id: 99,
        googleId: 'google-123',
      });

      await expect(
        service.linkGoogle(verifiedUser.id, 'google-123'),
      ).rejects.toThrow(ConflictException);
      expect(mockRepo.setGoogleId).not.toHaveBeenCalled();
    });

    it('Should be idempotent when the googleId is already linked to the same user', async () => {
      const alreadyLinked = { ...verifiedUser, googleId: 'google-123' };
      mockRepo.findByGoogleId.mockResolvedValue(alreadyLinked);

      const result = await service.linkGoogle(verifiedUser.id, 'google-123');

      expect(result).toEqual(alreadyLinked);
      expect(mockRepo.setGoogleId).not.toHaveBeenCalled();
    });
  });

  describe('Get Auth User', () => {
    it('Should get auth user successfully', async () => {
      mockRepo.findById.mockResolvedValue(user);

      const result = await service.getAuthUser(user.id);

      expect(result).toEqual({
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });
    });

    it('Should throw error if user no longer exists', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getAuthUser(user.id)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
