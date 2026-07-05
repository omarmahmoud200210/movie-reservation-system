# Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every `DEFERRED(phase-8)` marker with a real per-user rate-limit guard, and add the IP-based middleware layer for the two unauthenticated routes (`POST /auth/login`, `GET /movies`) — both reusing a corrected `RateLimiterService`.

**Architecture:** Fix the two correctness bugs in `RateLimiterService.rateLimiter()` first (everything else depends on its output being trustworthy). Then a `@RateLimit(...)` decorator + `RateLimitGuard` (mirroring the existing `@Roles`/`RolesGuard` pattern) handles the per-user layer; a small `IpRateLimitMiddleware` with an internal route→rule lookup handles the per-IP layer, registered via `AppModule.configure()`.

**Tech Stack:** NestJS, `ioredis` (`client.eval` for the Lua script), Jest + `@nestjs/testing`.

**Spec:** `docs/superpowers/specs/2026-07-05-rate-limiting-design.md`

---

## Before you start

Read `docs/superpowers/specs/2026-07-05-rate-limiting-design.md` in full. Key decisions already made
(don't re-litigate):

- **Two layers, not one.** Per-user (`RateLimitGuard`, needs `req.user.id` from `JwtAuthGuard`) for
  `POST /reservations` and all 5 `users.controller.ts` routes; per-IP (`IpRateLimitMiddleware`, no user
  yet) for `POST /auth/login` and `GET /movies`.
- **`RateLimiterService` gets a full-body rewrite of `rateLimiter()`**, moving the check-and-record into
  one atomic Redis Lua script (`EVAL`) instead of a plain pipeline. This fixes two real bugs: rejected
  requests were being recorded (self-perpetuating blocks), and `resetAfterMs` was hardcoded to the full
  window instead of computed from the oldest surviving entry. `RateLimiterConfig` / `RateLimiterResult`
  interfaces are unchanged — only the method body and the new script constant change.
- **The 5 `users.controller.ts` routes all share one rule** (10/1hour, uniform — including the read-only
  `GET /users/me/email/pending`), matching architecture.md's single `PUT /user/settings` rule rather than
  inventing per-route distinctions it doesn't make.
- **`IpRateLimitMiddleware` uses an internal lookup table, not metadata** — Express-style middleware has
  no `ExecutionContext`/`Reflector` access to read handler decorators, unlike a guard. Two routes is
  little enough that this stays simple.
- **The middleware writes the 429 response directly** (`res.status(429).json(...)`) instead of throwing
  `HttpException` — middleware sits in Express's stack ahead of where Nest's exception-filter pipeline
  takes over, so a thrown error there wouldn't be caught the way it is in a guard.
- **No new dependencies.** No `@nestjs/throttler`, no rate-limiting library — everything reuses the
  already-installed `ioredis` client directly.

---

## Task 1: Fix `RateLimiterService.rateLimiter`

**Files:**
- Modify: `backend/src/redis/rate-limiter.service.ts`
- Create: `backend/src/redis/test/rate-limiter.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/redis/test/rate-limiter.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import RateLimiterService from '../rate-limiter.service';
import RedisCache from '../redis.cache';

jest.mock('crypto', () => ({
  ...jest.requireActual<typeof import('crypto')>('crypto'),
  randomUUID: jest.fn(),
}));

const FIXED_MEMBER = 'fixed-member-uuid';

const mockClient = { eval: jest.fn() };
const mockRedis = { getClient: jest.fn(() => mockClient) };

describe('RateLimiterService', () => {
  let service: RateLimiterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (randomUUID as jest.Mock).mockReturnValue(FIXED_MEMBER);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: RedisCache, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
  });

  describe('rateLimiter', () => {
    it('calls eval with the key, 1 key, now, window, maxRequests, and a fresh member', async () => {
      mockClient.eval.mockResolvedValue([1, 2, 60_000]);

      await service.rateLimiter('rate_limit:user:1:test', {
        windowSize: 60_000,
        maxRequests: 3,
      });

      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'rate_limit:user:1:test',
        expect.any(Number),
        60_000,
        3,
        FIXED_MEMBER,
      );
    });

    it('maps an allowed script reply to allowed: true with the given remaining/resetAfterMs', async () => {
      mockClient.eval.mockResolvedValue([1, 2, 60_000]);

      const result = await service.rateLimiter('rate_limit:user:1:test', {
        windowSize: 60_000,
        maxRequests: 3,
      });

      expect(result).toEqual({ allowed: true, remaining: 2, resetAfterMs: 60_000 });
    });

    it('maps a blocked script reply to allowed: false with the computed resetAfterMs', async () => {
      mockClient.eval.mockResolvedValue([0, 0, 15_000]);

      const result = await service.rateLimiter('rate_limit:user:1:test', {
        windowSize: 60_000,
        maxRequests: 3,
      });

      expect(result).toEqual({ allowed: false, remaining: 0, resetAfterMs: 15_000 });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/redis/test/rate-limiter.service.spec.ts`
Expected: FAIL — `mockClient.eval` never called (current implementation uses `client.multi()`, not `client.eval`)

- [ ] **Step 3: Replace `rateLimiter()`'s implementation**

Replace the full contents of `backend/src/redis/rate-limiter.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import RedisCache from './redis.cache';
import { randomUUID } from 'node:crypto';

export interface RateLimiterConfig {
  windowSize: number;
  maxRequests: number;
}

export interface RateLimiterResult {
  allowed: boolean;
  remaining: number;
  resetAfterMs: number;
}

// Atomic check-and-record: ZREMRANGEBYSCORE drops expired entries, ZCARD counts what's left, and only
// if under the limit does it ZADD the new entry — all in one script, so no concurrent request can read
// the pre-add count before this one writes (the race a plain pipeline would have). ARGV: now, window
// (ms), maxRequests, member (a fresh UUID per call, so retries never collide with a real prior entry).
const RATE_LIMITER_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local member = ARGV[4]

local windowStart = now - window
redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
local count = redis.call('ZCARD', key)

if count < maxRequests then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, maxRequests - count - 1, window}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAfter = window
if oldest[2] then
  resetAfter = tonumber(oldest[2]) + window - now
  if resetAfter < 0 then resetAfter = 0 end
end
return {0, 0, resetAfter}
`;

@Injectable()
export default class RateLimiterService {
  constructor(private readonly redis: RedisCache) {}

  private getClient() {
    return this.redis.getClient();
  }

  async rateLimiter(
    key: string,
    config: RateLimiterConfig,
  ): Promise<RateLimiterResult> {
    const client = this.getClient();
    const now = Date.now();
    const member = randomUUID();

    // ponytail: plain EVAL re-sends the script text every call; switch to
    // defineCommand + EVALSHA if this becomes a hot enough path for the
    // bandwidth to matter.
    const [allowed, remaining, resetAfterMs] = (await client.eval(
      RATE_LIMITER_SCRIPT,
      1,
      key,
      now,
      config.windowSize,
      config.maxRequests,
      member,
    )) as [number, number, number];

    return {
      allowed: allowed === 1,
      remaining,
      resetAfterMs,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/redis/test/rate-limiter.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/redis/rate-limiter.service.ts backend/src/redis/test/rate-limiter.service.spec.ts
git commit -m "fix(redis): make RateLimiterService atomic and fix resetAfterMs"
```

---

## Task 2: `@RateLimit(...)` decorator

**Files:**
- Create: `backend/src/common/decorators/rate-limit.decorator.ts`

No test file — mirrors `backend/src/common/decorators/roles.decorator.ts`, which also has no spec (a
one-line `SetMetadata` wrapper has nothing to unit test beyond what the guard's tests already cover).

- [ ] **Step 1: Create the decorator**

```ts
// backend/src/common/decorators/rate-limit.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitConfig {
  /** Max requests allowed within `duration`. */
  points: number;
  /** Window size in milliseconds. */
  duration: number;
  /** Stable identifier for the Redis key — not the route path. */
  key: string;
}

/**
 * Rate-limit a route handler (or controller) per authenticated user.
 * Read by {@link RateLimitGuard}; keyed on `rate_limit:user:{userId}:{key}`.
 *
 * @example @RateLimit({ points: 3, duration: 60_000, key: 'reservations:create' })
 */
export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/common/decorators/rate-limit.decorator.ts
git commit -m "feat(common): add @RateLimit decorator"
```

---

## Task 3: `RateLimitGuard`

**Files:**
- Create: `backend/src/common/guards/rate-limit.guard.ts`
- Create: `backend/src/common/test/rate-limit.guard.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/common/test/rate-limit.guard.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import RateLimiterService from '../../redis/rate-limiter.service';

const mockReflector = { getAllAndOverride: jest.fn() };
const mockRateLimiter = { rateLimiter: jest.fn() };

function mockContext(user?: { id: number }) {
  const request = { user };
  const response = { setHeader: jest.fn() };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext & { __response: typeof response };
}

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: RateLimiterService, useValue: mockRateLimiter },
      ],
    }).compile();

    guard = module.get<RateLimitGuard>(RateLimitGuard);
  });

  it('allows the request and never calls RateLimiterService when there is no @RateLimit metadata', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const context = mockContext({ id: 1 });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockRateLimiter.rateLimiter).not.toHaveBeenCalled();
  });

  it('allows the request when RateLimiterService reports allowed: true', async () => {
    mockReflector.getAllAndOverride.mockReturnValue({
      points: 3,
      duration: 60_000,
      key: 'reservations:create',
    });
    mockRateLimiter.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 2,
      resetAfterMs: 60_000,
    });
    const context = mockContext({ id: 1 });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockRateLimiter.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:user:1:reservations:create',
      { windowSize: 60_000, maxRequests: 3 },
    );
  });

  it('throws a 429 HttpException and sets Retry-After when RateLimiterService reports allowed: false', async () => {
    mockReflector.getAllAndOverride.mockReturnValue({
      points: 3,
      duration: 60_000,
      key: 'reservations:create',
    });
    mockRateLimiter.rateLimiter.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAfterMs: 15_500,
    });
    const context = mockContext({ id: 1 });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);

    const response = context.switchToHttp().getResponse() as { setHeader: jest.Mock };
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 16);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/common/test/rate-limit.guard.spec.ts`
Expected: FAIL — cannot find module `../guards/rate-limit.guard`

- [ ] **Step 3: Create the guard**

```ts
// backend/src/common/guards/rate-limit.guard.ts
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import RateLimiterService from '../../redis/rate-limiter.service';
import { RATE_LIMIT_KEY, RateLimitConfig } from '../decorators/rate-limit.decorator';
import type { AuthUser } from '../../auth/token.service';

/**
 * Reads `@RateLimit(...)` metadata and enforces it per authenticated user via
 * RateLimiterService. No metadata → route is unlimited. Requires JwtAuthGuard
 * to run first so `req.user` is populated.
 *
 * Pair with the auth guard: `@UseGuards(JwtAuthGuard, RateLimitGuard)`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<RateLimitConfig>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!config) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const user = request.user as AuthUser | undefined;

    const redisKey = `rate_limit:user:${user?.id}:${config.key}`;
    const result = await this.rateLimiter.rateLimiter(redisKey, {
      windowSize: config.duration,
      maxRequests: config.points,
    });

    if (!result.allowed) {
      const response = http.getResponse<Response>();
      response.setHeader('Retry-After', Math.ceil(result.resetAfterMs / 1000));
      throw new HttpException(
        'Too many requests, please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/common/test/rate-limit.guard.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/guards/rate-limit.guard.ts backend/src/common/test/rate-limit.guard.spec.ts
git commit -m "feat(common): add RateLimitGuard"
```

---

## Task 4: Wire the guard onto `POST /reservations`

**Files:**
- Modify: `backend/src/reservations/reservations.controller.ts`
- Modify: `backend/src/reservations/test/reservations.controller.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add `RateLimitGuard` and `RATE_LIMIT_KEY` imports to
`backend/src/reservations/test/reservations.controller.spec.ts`, and add a new `describe` block after
the existing `guard wiring (class-level)` block, right before the file's final closing `});`:

```ts
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RATE_LIMIT_KEY } from '../../common/decorators/rate-limit.decorator';
```

```ts
  describe('rate limit wiring (method-level, reserve)', () => {
    it('guards reserve() with RateLimitGuard', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        ReservationsController.prototype.reserve,
      );
      expect(guards).toEqual([RateLimitGuard]);
    });

    it('rate-limits reserve() to 3 requests / 1 min', () => {
      const config = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        ReservationsController.prototype.reserve,
      );
      expect(config).toEqual({
        points: 3,
        duration: 60_000,
        key: 'reservations:create',
      });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/reservations/test/reservations.controller.spec.ts`
Expected: FAIL — `Reflect.getMetadata(GUARDS_METADATA, ReservationsController.prototype.reserve)` is
`undefined`, not `[RateLimitGuard]`

- [ ] **Step 3: Apply the guard and decorator**

In `backend/src/reservations/reservations.controller.ts`, add the imports:

```ts
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
```

Replace the `reserve()` method (removing the `DEFERRED(phase-8)` comment):

```ts
  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 3, duration: 60_000, key: 'reservations:create' })
  reserve(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservationsService.reserve(user.id, dto);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/reservations/test/reservations.controller.spec.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add backend/src/reservations/reservations.controller.ts backend/src/reservations/test/reservations.controller.spec.ts
git commit -m "feat(reservations): resolve phase-8 rate-limit marker on POST /reservations"
```

---

## Task 5: Wire the guard onto all 5 `UsersController` routes

**Files:**
- Modify: `backend/src/users/users.controller.ts`
- Modify: `backend/src/users/test/users.controller.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add imports to `backend/src/users/test/users.controller.spec.ts`:

```ts
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RATE_LIMIT_KEY } from '../../common/decorators/rate-limit.decorator';
```

Update the existing `guard wiring (class-level)` block's expectation (class-level guards are now both
`JwtAuthGuard` and `RateLimitGuard`):

```ts
  describe('guard wiring (class-level)', () => {
    it('guards the whole controller with JwtAuthGuard and RateLimitGuard', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, UsersController);
      expect(guards).toEqual([JwtAuthGuard, RateLimitGuard]);
    });
  });
```

Then add a new `describe` block right after it, before the file's final closing `});`:

```ts
  describe('rate limit wiring (per-route)', () => {
    const USERS_RATE_LIMIT = { points: 10, duration: 3_600_000 };

    it('rate-limits updateName to 10/1hour under key users:name', () => {
      const config = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.updateName,
      );
      expect(config).toEqual({ ...USERS_RATE_LIMIT, key: 'users:name' });
    });

    it('rate-limits requestEmailChange to 10/1hour under key users:email-request', () => {
      const config = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.requestEmailChange,
      );
      expect(config).toEqual({ ...USERS_RATE_LIMIT, key: 'users:email-request' });
    });

    it('rate-limits confirmEmailChange to 10/1hour under key users:email-confirm', () => {
      const config = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.confirmEmailChange,
      );
      expect(config).toEqual({ ...USERS_RATE_LIMIT, key: 'users:email-confirm' });
    });

    it('rate-limits getPendingEmailChange to 10/1hour under key users:email-pending', () => {
      const config = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.getPendingEmailChange,
      );
      expect(config).toEqual({ ...USERS_RATE_LIMIT, key: 'users:email-pending' });
    });

    it('rate-limits changePassword to 10/1hour under key users:password', () => {
      const config = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        UsersController.prototype.changePassword,
      );
      expect(config).toEqual({ ...USERS_RATE_LIMIT, key: 'users:password' });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/users/test/users.controller.spec.ts`
Expected: FAIL — class-level guards still resolve to `[JwtAuthGuard]` only, and no `@RateLimit` metadata
exists on any handler yet

- [ ] **Step 3: Apply the guard and decorators**

In `backend/src/users/users.controller.ts`, add the imports:

```ts
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
```

Replace the whole class (adding `RateLimitGuard` at class level and one `@RateLimit(...)` per route,
removing all 5 `DEFERRED(phase-8)` comments):

```ts
@Controller('users')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  @RateLimit({ points: 10, duration: 3_600_000, key: 'users:name' })
  updateName(@CurrentUser() user: AuthUser, @Body() dto: UpdateNameDto) {
    return this.usersService.updateName(user.id, dto.name);
  }

  @Post('me/email')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 3_600_000, key: 'users:email-request' })
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

  @Post('me/email/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 3_600_000, key: 'users:email-confirm' })
  confirmEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    return this.usersService.confirmEmailChange(user.id, dto.code);
  }

  @Get('me/email/pending')
  @RateLimit({ points: 10, duration: 3_600_000, key: 'users:email-pending' })
  getPendingEmailChange(@CurrentUser() user: AuthUser) {
    return this.usersService.getPendingEmailChange(user.id);
  }

  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 3_600_000, key: 'users:password' })
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
Expected: PASS (all tests, including the 6 new/updated ones)

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/users.controller.ts backend/src/users/test/users.controller.spec.ts
git commit -m "feat(users): resolve phase-8 rate-limit markers on all 5 routes"
```

---

## Task 6: `IpRateLimitMiddleware`

**Files:**
- Create: `backend/src/common/middleware/ip-rate-limit.middleware.ts`
- Create: `backend/src/common/test/ip-rate-limit.middleware.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/common/test/ip-rate-limit.middleware.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { IpRateLimitMiddleware } from '../middleware/ip-rate-limit.middleware';
import RateLimiterService from '../../redis/rate-limiter.service';

const mockRateLimiter = { rateLimiter: jest.fn() };

function mockReqRes(method: string, path: string, ip = '1.2.3.4') {
  const req = { method, path, ip } as never;
  const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as never;
  const next = jest.fn();
  return { req, res: res as { setHeader: jest.Mock; status: jest.Mock; json: jest.Mock }, next };
}

describe('IpRateLimitMiddleware', () => {
  let middleware: IpRateLimitMiddleware;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpRateLimitMiddleware,
        { provide: RateLimiterService, useValue: mockRateLimiter },
      ],
    }).compile();

    middleware = module.get<IpRateLimitMiddleware>(IpRateLimitMiddleware);
  });

  it('calls next() and never checks the rate limiter for an unmatched route', async () => {
    const { req, res, next } = mockReqRes('GET', 'auth/login');

    await middleware.use(req, res as never, next);

    expect(mockRateLimiter.rateLimiter).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('checks POST /auth/login at 5/15min and calls next() when allowed', async () => {
    mockRateLimiter.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAfterMs: 900_000,
    });
    const { req, res, next } = mockReqRes('POST', 'auth/login');

    await middleware.use(req, res as never, next);

    expect(mockRateLimiter.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:ip:1.2.3.4:auth:login',
      { windowSize: 900_000, maxRequests: 5 },
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('checks GET /movies at 60/1min and calls next() when allowed', async () => {
    mockRateLimiter.rateLimiter.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAfterMs: 60_000,
    });
    const { req, res, next } = mockReqRes('GET', 'movies');

    await middleware.use(req, res as never, next);

    expect(mockRateLimiter.rateLimiter).toHaveBeenCalledWith(
      'rate_limit:ip:1.2.3.4:movies:browse',
      { windowSize: 60_000, maxRequests: 60 },
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('writes a 429 with Retry-After and never calls next() when blocked', async () => {
    mockRateLimiter.rateLimiter.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAfterMs: 12_500,
    });
    const { req, res, next } = mockReqRes('POST', 'auth/login');

    await middleware.use(req, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 13);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many requests, please try again later',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/common/test/ip-rate-limit.middleware.spec.ts`
Expected: FAIL — cannot find module `../middleware/ip-rate-limit.middleware`

- [ ] **Step 3: Create the middleware**

```ts
// backend/src/common/middleware/ip-rate-limit.middleware.ts
import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import RateLimiterService from '../../redis/rate-limiter.service';

interface IpRateLimitRule {
  points: number;
  duration: number;
  key: string;
}

// architecture.md's IP-keyed rules for the two routes this middleware is registered on
// (AppModule.configure()). A per-route lookup, not metadata — middleware has no
// ExecutionContext / handler decorators to read, unlike RateLimitGuard.
const RULES: Record<string, IpRateLimitRule> = {
  'POST /auth/login': { points: 5, duration: 15 * 60_000, key: 'auth:login' },
  'GET /movies': { points: 60, duration: 60_000, key: 'movies:browse' },
};

@Injectable()
export class IpRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rule = RULES[`${req.method} ${req.path}`];
    if (!rule) return next();

    const redisKey = `rate_limit:ip:${req.ip}:${rule.key}`;
    const result = await this.rateLimiter.rateLimiter(redisKey, {
      windowSize: rule.duration,
      maxRequests: rule.points,
    });

    if (!result.allowed) {
      res.setHeader('Retry-After', Math.ceil(result.resetAfterMs / 1000));
      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests, please try again later',
      });
      return;
    }
    next();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/common/test/ip-rate-limit.middleware.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/middleware/ip-rate-limit.middleware.ts backend/src/common/test/ip-rate-limit.middleware.spec.ts
git commit -m "feat(common): add IpRateLimitMiddleware"
```

---

## Task 7: Register `IpRateLimitMiddleware` in `AppModule`

**Files:**
- Modify: `backend/src/app.module.ts`
- Create: `backend/src/test/app.module.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/test/app.module.spec.ts
import type { MiddlewareConsumer } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from '../app.module';
import { IpRateLimitMiddleware } from '../common/middleware/ip-rate-limit.middleware';

describe('AppModule', () => {
  describe('configure', () => {
    it('applies IpRateLimitMiddleware to POST auth/login and GET movies', () => {
      const forRoutes = jest.fn();
      const apply = jest.fn().mockReturnValue({ forRoutes });
      const consumer = { apply } as unknown as MiddlewareConsumer;

      new AppModule().configure(consumer);

      expect(apply).toHaveBeenCalledWith(IpRateLimitMiddleware);
      expect(forRoutes).toHaveBeenCalledWith(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'movies', method: RequestMethod.GET },
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/test/app.module.spec.ts`
Expected: FAIL — `AppModule` doesn't implement `configure`, so `new AppModule().configure` is not a
function

- [ ] **Step 3: Add `NestModule.configure` to `AppModule`**

Replace the full contents of `backend/src/app.module.ts`:

```ts
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailerModule } from './mailer/mailer.module';
import { AuthModule } from './auth/auth.module';
import { MoviesModule } from './movies/movies.module';
import { ScreeningsModule } from './screenings/screenings.module';
import { ReservationsModule } from './reservations/reservations.module';
import { GatewayModule } from './gateway/gateway.module';
import { UsersModule } from './users/users.module';
import { CronModule } from './cron/cron.module';
import { IpRateLimitMiddleware } from './common/middleware/ip-rate-limit.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    MailerModule,
    AuthModule,
    MoviesModule,
    ScreeningsModule,
    ReservationsModule,
    UsersModule,
    GatewayModule,
    CronModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(IpRateLimitMiddleware)
      .forRoutes(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'movies', method: RequestMethod.GET },
      );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/test/app.module.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.module.ts backend/src/test/app.module.spec.ts
git commit -m "feat: register IpRateLimitMiddleware for POST auth/login and GET movies"
```

---

## Final check

- [ ] Run the full backend suite: `cd backend && npx jest`
- [ ] Run the typecheck: `cd backend && npx tsc --noEmit -p tsconfig.build.json`
- [ ] Grep for any remaining `DEFERRED(phase-8)` markers — should be none left:
      `grep -rn "DEFERRED(phase-8)" backend/src`
- [ ] Confirm `architecture.md`'s Rate Limiting Layer section (§5) needs no edits (per the spec's
      "Companion changes" section — it already documents both layers as implemented).
