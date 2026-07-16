import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import type { Response } from 'express';

// Modules...
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';

const mockAuthService = {
  register: jest.fn(),
  verifyOtp: jest.fn(),
  resendOtp: jest.fn(),
  getAuthUser: jest.fn(),
  resolveGoogleUser: jest.fn(),
  linkGoogle: jest.fn(),
};

const mockTokenService = {
  issueAuthCookies: jest.fn(),
  rotateAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn(),
  verifyLinkState: jest.fn(),
  revokeAllSessions: jest.fn(),
};

const res = {} as Response;

const user = {
  id: 1,
  email: '[EMAIL_ADDRESS]',
  name: 'John Doe',
  role: 'USER',
};

const RegisterDto = {
  email: '[EMAIL_ADDRESS]',
  password: '123',
  name: 'John Doe',
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: TokenService, useValue: mockTokenService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('Register', () => {
    it('should register a new user successfully', async () => {
      mockAuthService.register.mockResolvedValue({
        message: 'Verification code sent',
      });
      const result = await controller.register(RegisterDto);

      expect(result).toEqual({ message: 'Verification code sent' });
      expect(mockAuthService.register).toHaveBeenCalledWith(RegisterDto);
    });
  });

  describe('Resend OTP', () => {
    it('should resend OTP successfully', async () => {
      mockAuthService.resendOtp.mockResolvedValue({
        message: 'Verification code sent',
      });
      const result = await controller.resendOtp({ email: user.email });

      expect(result).toEqual({ message: 'Verification code sent' });
      expect(mockAuthService.resendOtp).toHaveBeenCalledWith({
        email: user.email,
      });
    });
  });

  describe('Verify OTP', () => {
    it('should verify OTP successfully', async () => {
      mockAuthService.verifyOtp.mockResolvedValue(user);
      mockTokenService.issueAuthCookies.mockResolvedValue(user);
      const result = await controller.verifyOtp(
        { email: user.email, code: '123456' },
        res,
      );

      expect(result).toEqual(user);
      expect(mockAuthService.verifyOtp).toHaveBeenCalledWith({
        email: user.email,
        code: '123456',
      });
      expect(mockTokenService.issueAuthCookies).toHaveBeenCalledWith(res, user);
    });
  });

  describe('Login', () => {
    it('should issue cookies for the validated user and return it', async () => {
      mockTokenService.issueAuthCookies.mockResolvedValue(undefined);
      const result = await controller.login(
        { email: user.email, password: '123' },
        user,
        res,
      );

      expect(result).toEqual(user);
      expect(mockTokenService.issueAuthCookies).toHaveBeenCalledWith(res, user);
    });
  });

  describe('Refresh', () => {
    it('should rotate cookies with a fresh user and return a message', async () => {
      const refreshUser = { id: user.id, jti: 'jti-123' };
      mockAuthService.getAuthUser.mockResolvedValue(user);
      mockTokenService.rotateAuthCookies.mockResolvedValue(undefined);

      const result = await controller.refresh(refreshUser, res);

      expect(result).toEqual({ message: 'Token refreshed' });
      expect(mockAuthService.getAuthUser).toHaveBeenCalledWith(refreshUser.id);
      expect(mockTokenService.rotateAuthCookies).toHaveBeenCalledWith(
        res,
        { id: refreshUser.id, jti: refreshUser.jti },
        user,
      );
    });
  });

  describe('Google callback', () => {
    const googleProfile = {
      email: user.email,
      name: user.name,
      googleId: 'google-123',
    };

    it('should issue cookies and redirect to the frontend on success', async () => {
      const redirect = jest.fn();
      const redirectRes = { redirect } as unknown as Response;
      mockAuthService.resolveGoogleUser.mockResolvedValue(user);
      mockTokenService.issueAuthCookies.mockResolvedValue(undefined);

      await controller.googleCallback(googleProfile, redirectRes);

      expect(mockAuthService.resolveGoogleUser).toHaveBeenCalledWith(
        googleProfile,
      );
      expect(mockTokenService.issueAuthCookies).toHaveBeenCalledWith(
        redirectRes,
        user,
      );
      expect(redirect).toHaveBeenCalledWith(
        `${process.env.FRONTEND_URL}/auth/google/callback`,
      );
    });

    it('should redirect to the error page when the account is blocked', async () => {
      const redirect = jest.fn();
      const redirectRes = { redirect } as unknown as Response;
      mockAuthService.resolveGoogleUser.mockRejectedValue(
        new ConflictException('blocked'),
      );

      await controller.googleCallback(googleProfile, redirectRes);

      expect(mockTokenService.issueAuthCookies).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith(
        `${process.env.FRONTEND_URL}/login?error=account_exists`,
      );
    });
  });

  describe('Link Google callback', () => {
    const googleProfile = {
      email: user.email,
      name: user.name,
      googleId: 'google-123',
    };

    const req = {
      query: { state: 'state-token' },
    } as unknown as import('express').Request;

    it('links the googleId to the user bound in the state and redirects to settings', async () => {
      const redirect = jest.fn();
      const redirectRes = { redirect } as unknown as Response;
      mockTokenService.verifyLinkState.mockReturnValue({ id: user.id });
      mockAuthService.linkGoogle.mockResolvedValue({
        ...user,
        googleId: 'google-123',
      });

      await controller.linkGoogleCallback(googleProfile, req, redirectRes);

      expect(mockTokenService.verifyLinkState).toHaveBeenCalledWith(
        'state-token',
      );
      expect(mockAuthService.linkGoogle).toHaveBeenCalledWith(
        user.id,
        'google-123',
      );
      expect(redirect).toHaveBeenCalledWith(
        `${process.env.FRONTEND_URL}/settings?linked=google`,
      );
    });

    it('redirects with an error when the googleId is already linked elsewhere', async () => {
      const redirect = jest.fn();
      const redirectRes = { redirect } as unknown as Response;
      mockTokenService.verifyLinkState.mockReturnValue({ id: user.id });
      mockAuthService.linkGoogle.mockRejectedValue(
        new ConflictException('taken'),
      );

      await controller.linkGoogleCallback(googleProfile, req, redirectRes);

      expect(redirect).toHaveBeenCalledWith(
        `${process.env.FRONTEND_URL}/settings?error=google_already_linked`,
      );
    });
  });

  describe('Logout', () => {
    it('should revoke sessions, clear cookies, and return a message', async () => {
      const result = await controller.logout(user, res);

      expect(result).toEqual({ message: 'Logged out' });
      expect(mockTokenService.revokeAllSessions).toHaveBeenCalledWith(user.id);
      expect(mockTokenService.clearAuthCookies).toHaveBeenCalledWith(res);
    });
  });

  describe('Me', () => {
    it('should return the current user', () => {
      const result = controller.me(user);

      expect(result).toEqual(user);
    });
  });
});
