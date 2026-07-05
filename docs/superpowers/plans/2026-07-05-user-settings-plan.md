# User Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user update their name, change their email (via OTP confirmation to the new address, preserving the `emailVerified` invariant), and change their password (revoking every other active session) — via a new `UsersModule` that reuses `AuthService`, `OtpService`, `TokenService`, and `MailerService` rather than inventing new primitives.

**Architecture:** New `src/users/` module: `UsersRepository` (thin Prisma wrappers, untested — same convention as `AuthRepository`), `UsersService` (all business logic), `UsersController` (five `JwtAuthGuard`-protected routes). `AuthModule` gains an `exports` array (it currently has none) so `UsersModule` can inject `AuthService`, `OtpService`, `TokenService`. `TokenService` gains one new method, `revokeAllSessions`, used only by password change.

**Tech Stack:** NestJS, Prisma, `bcrypt`, `RedisCache` (existing `pending_email:{userId}` key, TTL from `OTP_TTL_SECONDS`), Jest + `@nestjs/testing`.

**Spec:** `docs/superpowers/specs/2026-07-04-user-settings-design.md`

---

## Before you start

Read `docs/superpowers/specs/2026-07-04-user-settings-design.md` in full. Key decisions already made (don't re-litigate):

- **No `GET /users/me`.** `GET /auth/me` (`backend/src/auth/auth.controller.ts:101`) already serves this shape (`AuthUser`).
- **No rate limiting on these routes yet.** That's Phase 8. Leave a `DEFERRED(phase-8)` comment above each route, matching the existing convention at `backend/src/reservations/reservations.controller.ts:26`.
- **Google-only accounts (`password: null`) are out of scope for password/email change.** Mirror the existing guard shape from `AuthService.validateUser` (`backend/src/auth/auth.service.ts:61`): `if (!user?.password) throw new UnauthorizedException(...)`.
- **Never return the raw Prisma `User` row.** Every mutating endpoint returns `AuthUser` (`{ id, name, email, role }`) via `authService.getAuthUser(userId)`, never the repo's return value directly — that's how the password hash avoids leaking.
- **`revokeAllSessions` uses `KEYS`, not `SCAN`.** The keyspace pattern (`refresh:{userId}:*`) is scoped to one user's sessions — always small and bounded, not a full-keyspace scan. Precedent: `RateLimiterService` also calls `RedisCache.getClient()` directly (`backend/src/redis/rate-limiter.service.ts:20`).
- **`UsersRepository` gets no test file.** It's a thin Prisma wrapper with zero branching logic, same shape and same convention as `AuthRepository` (`backend/src/auth/auth.repository.ts`), which also has no spec file. Don't add one for symmetry with `ReservationsRepository` — that repo has a test because it has an atomic-query invariant to protect; this one doesn't.

---

## Task 1: `AuthModule` exports + `TokenService.revokeAllSessions`

**Files:**
- Modify: `backend/src/auth/auth.module.ts`
- Modify: `backend/src/auth/token.service.ts`
- Modify: `backend/src/auth/test/token.service.spec.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/auth/test/token.service.spec.ts`, add `getClient: jest.fn()` to the existing `mockRedis` object:

```ts
const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  getClient: jest.fn(),
};
```

Then add a new `describe` block at the end of the file, right before the final closing `});`:

```ts
  describe('revokeAllSessions', () => {
    it('deletes every refresh key matching the user when keys exist', async () => {
      const mockClient = {
        keys: jest.fn().mockResolvedValue(['refresh:1:jti-a', 'refresh:1:jti-b']),
        del: jest.fn(),
      };
      mockRedis.getClient.mockReturnValue(mockClient);

      await service.revokeAllSessions(1);

      expect(mockClient.keys).toHaveBeenCalledWith('refresh:1:*');
      expect(mockClient.del).toHaveBeenCalledWith(
        'refresh:1:jti-a',
        'refresh:1:jti-b',
      );
    });

    it('no-ops cleanly when there are no matching keys', async () => {
      const mockClient = {
        keys: jest.fn().mockResolvedValue([]),
        del: jest.fn(),
      };
      mockRedis.getClient.mockReturnValue(mockClient);

      await service.revokeAllSessions(1);

      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/auth/test/token.service.spec.ts -t revokeAllSessions`
Expected: FAIL — `service.revokeAllSessions is not a function`

- [ ] **Step 3: Implement `revokeAllSessions`**

In `backend/src/auth/token.service.ts`, add this method inside the `TokenService` class (after `clearAuthCookies`, before the closing `}` of the class):

```ts
  /**
   * Revokes every refresh session for a user (e.g. on password change). Scoped
   * to one user's keyspace, so KEYS is fine here — always a small, bounded set,
   * not a whole-keyspace scan.
   */
  async revokeAllSessions(userId: number): Promise<void> {
    const client = this.redis.getClient();
    const keys = await client.keys(`refresh:${userId}:*`);
    if (keys.length > 0) {
      await client.del(...keys);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/auth/test/token.service.spec.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Add the `exports` array to `AuthModule`**

In `backend/src/auth/auth.module.ts`, add an `exports` key to the `@Module` decorator:

```ts
@Module({
  imports: [MailerModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    OtpService,
    TokenService,
    LocalStrategy,
    JwtStrategy,
    JwtRefreshStrategy,
    GoogleStrategy,
    GoogleLinkStrategy,
  ],
  exports: [AuthService, OtpService, TokenService],
})
export class AuthModule {}
```

- [ ] **Step 6: Verify the whole auth suite still passes**

Run: `cd backend && npx jest src/auth`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth/auth.module.ts backend/src/auth/token.service.ts backend/src/auth/test/token.service.spec.ts
git commit -m "feat(auth): export AuthService/OtpService/TokenService, add revokeAllSessions"
```

---

## Task 2: `UsersRepository` + DTOs

**Files:**
- Create: `backend/src/users/users.repository.ts`
- Create: `backend/src/users/dto/update-name.dto.ts`
- Create: `backend/src/users/dto/request-email-change.dto.ts`
- Create: `backend/src/users/dto/confirm-email-change.dto.ts`
- Create: `backend/src/users/dto/change-password.dto.ts`

No test file — see "Before you start" for why (thin Prisma wrapper, same convention as `AuthRepository`).

- [ ] **Step 1: Create `UsersRepository`**

```ts
// backend/src/users/users.repository.ts
import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  updateName(id: number, name: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { name } });
  }

  updateEmail(id: number, email: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { email } });
  }

  updatePassword(id: number, password: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { password } });
  }
}
```

- [ ] **Step 2: Create the DTOs**

```ts
// backend/src/users/dto/update-name.dto.ts
import { IsString, MinLength } from 'class-validator';

export class UpdateNameDto {
  @IsString()
  @MinLength(2)
  name: string;
}
```

```ts
// backend/src/users/dto/request-email-change.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RequestEmailChangeDto {
  @IsEmail()
  newEmail: string;

  @IsString()
  @MinLength(8)
  currentPassword: string;
}
```

```ts
// backend/src/users/dto/confirm-email-change.dto.ts
import { Length } from 'class-validator';

export class ConfirmEmailChangeDto {
  @Length(6, 6)
  code: string;
}
```

```ts
// backend/src/users/dto/change-password.dto.ts
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
```

- [ ] **Step 3: Verify the project still builds**

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no new errors (existing repo/DTO files aren't wired into any module yet, so nothing imports them — this just checks the files themselves are valid TypeScript)

- [ ] **Step 4: Commit**

```bash
git add backend/src/users/users.repository.ts backend/src/users/dto
git commit -m "feat(users): add UsersRepository and DTOs"
```

---

## Task 3: `UsersService.updateName`

**Files:**
- Create: `backend/src/users/users.service.ts`
- Create: `backend/src/users/test/users.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/users/test/users.service.spec.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts`
Expected: FAIL — cannot find module `../users.service`

- [ ] **Step 3: Write the minimal implementation**

```ts
// backend/src/users/users.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import { UsersRepository } from './users.repository';
import RedisCache from '../redis/redis.cache';
import { OtpService } from '../auth/otp.service';
import { MailerService } from '../mailer/mailer.service';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import type { AuthUser } from '../auth/token.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly redis: RedisCache,
    private readonly otp: OtpService,
    private readonly mailer: MailerService,
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  async updateName(userId: number, name: string): Promise<AuthUser> {
    await this.usersRepo.updateName(userId, name);
    return this.authService.getAuthUser(userId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/users.service.ts backend/src/users/test/users.service.spec.ts
git commit -m "feat(users): add UsersService.updateName"
```

---

## Task 4: `UsersService.requestEmailChange`

**Files:**
- Modify: `backend/src/users/users.service.ts`
- Modify: `backend/src/users/test/users.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `users.service.spec.ts`, after the `updateName` block:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts -t requestEmailChange`
Expected: FAIL — `service.requestEmailChange is not a function`

- [ ] **Step 3: Implement `requestEmailChange`**

Add to `UsersService` (after `updateName`):

```ts
  async requestEmailChange(
    userId: number,
    newEmail: string,
    currentPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.usersRepo.findById(userId);
    if (!user?.password) throw new UnauthorizedException('Invalid credentials');
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) throw new UnauthorizedException('Invalid credentials');

    const existing = await this.usersRepo.findByEmail(newEmail);
    if (existing) throw new ConflictException('Email already registered');

    await this.redis.set(
      `pending_email:${userId}`,
      newEmail,
      'EX',
      Number(process.env.OTP_TTL_SECONDS),
    );
    const code = await this.otp.issue(newEmail);
    await this.mailer.sendOtpEmail(newEmail, code);
    return { message: 'Verification code sent to new email' };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/users.service.ts backend/src/users/test/users.service.spec.ts
git commit -m "feat(users): add UsersService.requestEmailChange"
```

---

## Task 5: `UsersService.confirmEmailChange` + `getPendingEmailChange`

**Files:**
- Modify: `backend/src/users/users.service.ts`
- Modify: `backend/src/users/test/users.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  describe('confirmEmailChange', () => {
    it('throws 400 when there is no pending email change', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.confirmEmailChange(1, '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockOtp.verify).not.toHaveBeenCalled();
    });

    it('throws 400 when the code is invalid', async () => {
      mockRedis.get.mockResolvedValue('new@example.com');
      mockOtp.verify.mockResolvedValue(false);

      await expect(service.confirmEmailChange(1, 'wrong')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockRepo.updateEmail).not.toHaveBeenCalled();
    });

    it('on success, updates the email, clears the pending key, and returns the fresh AuthUser', async () => {
      mockRedis.get.mockResolvedValue('new@example.com');
      mockOtp.verify.mockResolvedValue(true);
      mockAuthService.getAuthUser.mockResolvedValue(authUser);

      const result = await service.confirmEmailChange(1, '123456');

      expect(mockOtp.verify).toHaveBeenCalledWith('new@example.com', '123456');
      expect(mockRepo.updateEmail).toHaveBeenCalledWith(1, 'new@example.com');
      expect(mockRedis.del).toHaveBeenCalledWith('pending_email:1');
      expect(result).toEqual(authUser);
    });
  });

  describe('getPendingEmailChange', () => {
    it('returns pending: true with the new email when a key exists', async () => {
      mockRedis.get.mockResolvedValue('new@example.com');

      await expect(service.getPendingEmailChange(1)).resolves.toEqual({
        pending: true,
        newEmail: 'new@example.com',
      });
    });

    it('returns pending: false when no key exists', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.getPendingEmailChange(1)).resolves.toEqual({
        pending: false,
      });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts -t "confirmEmailChange|getPendingEmailChange"`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Implement both methods**

Add to `UsersService` (after `requestEmailChange`):

```ts
  async confirmEmailChange(userId: number, code: string): Promise<AuthUser> {
    const pendingEmail = await this.redis.get(`pending_email:${userId}`);
    if (!pendingEmail) {
      throw new BadRequestException('No pending email change or it expired');
    }
    const ok = await this.otp.verify(pendingEmail, code);
    if (!ok) throw new BadRequestException('Invalid code');

    await this.usersRepo.updateEmail(userId, pendingEmail);
    await this.redis.del(`pending_email:${userId}`);
    return this.authService.getAuthUser(userId);
  }

  async getPendingEmailChange(
    userId: number,
  ): Promise<{ pending: true; newEmail: string } | { pending: false }> {
    const newEmail = await this.redis.get(`pending_email:${userId}`);
    return newEmail ? { pending: true, newEmail } : { pending: false };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/users.service.ts backend/src/users/test/users.service.spec.ts
git commit -m "feat(users): add UsersService.confirmEmailChange and getPendingEmailChange"
```

---

## Task 6: `UsersService.changePassword`

**Files:**
- Modify: `backend/src/users/users.service.ts`
- Modify: `backend/src/users/test/users.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  describe('changePassword', () => {
    const user = { id: 1, password: 'hashed' };
    const res = {} as never;

    it('throws 401 when the account has no password (Google-only)', async () => {
      mockRepo.findById.mockResolvedValue({ ...user, password: null });

      await expect(
        service.changePassword(1, 'current', 'newpassword', res),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when the current password is wrong', async () => {
      mockRepo.findById.mockResolvedValue(user);
      mockBcrypt.compare.mockResolvedValue(false as never);

      await expect(
        service.changePassword(1, 'wrong', 'newpassword', res),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockRepo.updatePassword).not.toHaveBeenCalled();
    });

    it('on success, hashes+stores the new password, revokes all sessions, and reissues cookies', async () => {
      mockRepo.findById.mockResolvedValue(user);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockBcrypt.hash.mockResolvedValue('new-hash' as never);
      mockAuthService.getAuthUser.mockResolvedValue(authUser);

      await service.changePassword(1, 'current', 'newpassword', res);

      expect(mockBcrypt.hash).toHaveBeenCalledWith('newpassword', 10);
      expect(mockRepo.updatePassword).toHaveBeenCalledWith(1, 'new-hash');
      expect(mockTokenService.revokeAllSessions).toHaveBeenCalledWith(1);
      expect(mockTokenService.issueAuthCookies).toHaveBeenCalledWith(res, authUser);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts -t changePassword`
Expected: FAIL — `service.changePassword is not a function`

- [ ] **Step 3: Implement `changePassword`**

Add to `UsersService` (after `getPendingEmailChange`):

```ts
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    res: Response,
  ): Promise<void> {
    const user = await this.usersRepo.findById(userId);
    if (!user?.password) throw new UnauthorizedException('Invalid credentials');
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) throw new UnauthorizedException('Invalid credentials');

    const hash = await bcrypt.hash(newPassword, 10);
    await this.usersRepo.updatePassword(userId, hash);

    await this.tokenService.revokeAllSessions(userId);
    const authUser = await this.authService.getAuthUser(userId);
    await this.tokenService.issueAuthCookies(res, authUser);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/users/test/users.service.spec.ts`
Expected: PASS (full file, all describe blocks)

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/users.service.ts backend/src/users/test/users.service.spec.ts
git commit -m "feat(users): add UsersService.changePassword"
```

---

## Task 7: `UsersController`

**Files:**
- Create: `backend/src/users/users.controller.ts`
- Create: `backend/src/users/test/users.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/users/test/users.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from '../users.controller';
import { UsersService } from '../users.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

const mockService = {
  updateName: jest.fn(),
  requestEmailChange: jest.fn(),
  confirmEmailChange: jest.fn(),
  getPendingEmailChange: jest.fn(),
  changePassword: jest.fn(),
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
      providers: [{ provide: UsersService, useValue: mockService }],
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
    it('guards the whole controller with JwtAuthGuard', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, UsersController);
      expect(guards).toEqual([JwtAuthGuard]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/users/test/users.controller.spec.ts`
Expected: FAIL — cannot find module `../users.controller`

- [ ] **Step 3: Implement `UsersController`**

```ts
// backend/src/users/users.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/token.service';
import { UsersService } from './users.service';
import { UpdateNameDto } from './dto/update-name.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * Authenticated user-settings actions. The caller identity always comes from
 * the JWT (`@CurrentUser()`), never from the request body.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Patch('me')
  updateName(@CurrentUser() user: AuthUser, @Body() dto: UpdateNameDto) {
    return this.usersService.updateName(user.id, dto.name);
  }

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Post('me/email')
  @HttpCode(HttpStatus.OK)
  requestEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.usersService.requestEmailChange(
      user.id,
      dto.newEmail,
      dto.currentPassword,
    );
  }

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Post('me/email/confirm')
  @HttpCode(HttpStatus.OK)
  confirmEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    return this.usersService.confirmEmailChange(user.id, dto.code);
  }

  // DEFERRED(phase-8): per-user rate limit on this route.
  @Get('me/email/pending')
  getPendingEmailChange(@CurrentUser() user: AuthUser) {
    return this.usersService.getPendingEmailChange(user.id);
  }

  // DEFERRED(phase-8): per-user rate limit on this route (maps to
  // architecture.md's `PUT /user/settings` rule — the most sensitive of the
  // five new routes; confirm exact mapping across all five when Phase 8 is
  // brainstormed).
  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.usersService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      res,
    );
    return { message: 'Password changed' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/users/test/users.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/users.controller.ts backend/src/users/test/users.controller.spec.ts
git commit -m "feat(users): add UsersController"
```

---

## Task 8: `UsersModule` + wire into `AppModule`

**Files:**
- Create: `backend/src/users/users.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create `UsersModule`**

```ts
// backend/src/users/users.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailerModule } from '../mailer/mailer.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';

/**
 * Authenticated user-settings actions (name, email, password). Imports
 * AuthModule for AuthService/OtpService/TokenService and MailerModule for
 * MailerService. Prisma and Redis are global, no explicit import needed.
 */
@Module({
  imports: [AuthModule, MailerModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
```

- [ ] **Step 2: Register it in `AppModule`**

In `backend/src/app.module.ts`, add the import:

```ts
import { UsersModule } from './users/users.module';
```

And add `UsersModule` to the `imports` array (after `ReservationsModule`, before `GatewayModule`, matching the API-layer ordering used elsewhere):

```ts
    ReservationsModule,
    UsersModule,
    GatewayModule,
```

- [ ] **Step 3: Verify the app boots and the full suite passes**

Run: `cd backend && npx jest`
Expected: PASS (entire suite, including all `src/users` and `src/auth` tests)

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/users/users.module.ts backend/src/app.module.ts
git commit -m "feat(users): wire UsersModule into AppModule"
```

---

## Task 9: Update `architecture.md`

**Files:**
- Modify: `architecture.md`

- [ ] **Step 1: Replace the `UsersModule` row**

In `architecture.md`, find this row (around line 201, in the "API Layer" table):

```
| UsersModule | GET /users/me, PUT /users/settings |
```

Replace it with:

```
| UsersModule | PATCH /users/me, POST /users/me/email, POST /users/me/email/confirm, GET /users/me/email/pending, POST /users/me/password |
```

- [ ] **Step 2: Commit**

```bash
git add architecture.md
git commit -m "docs: sync architecture.md UsersModule row with the shipped endpoints"
```

---

## Final check

- [ ] Run the full backend suite once more: `cd backend && npx jest`
- [ ] Run the linter if the project has one wired to CI: check `backend/package.json` for a `lint` script and run it if present.
