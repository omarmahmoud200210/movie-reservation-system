# Rate Limiting (User-Guard Layer) — Design

**Date:** 2026-07-05
**Build order:** Phase 8. Unblocked by the user-settings phase (`2026-07-04-user-settings-design.md`),
which added the `PUT /user/settings` rate-limit rule's real target endpoints.
**Depends on:** Reservations (✅, `POST /reservations` already carries a `DEFERRED(phase-8)` marker),
Users (✅, all 5 routes in `users.controller.ts` carry `DEFERRED(phase-8)` markers), `RateLimiterService`
(✅ exists, gets corrected in this phase — see below).

## Goal

Resolve every `DEFERRED(phase-8)` marker currently in the code by wiring real per-user rate limits onto
`POST /reservations` and the 5 `UsersController` routes, reusing the existing (but currently unwired and
buggy) `RateLimiterService` rather than adding a new library.

## Scope

**In:**
- A `@RateLimit(...)` decorator + `RateLimitGuard`, mirroring the existing `@Roles(...)` /
  `RolesGuard` pattern in `backend/src/common/`.
- Applying that guard to `POST /reservations` (method-level) and all 5 `UsersController` routes
  (class-level).
- Fixing the two correctness bugs in `RateLimiterService.rateLimiter()` (see "RateLimiterService
  corrections" below) — required before the guard can trust its output.

**Out (architecture.md's other documented layer, deferred to a later, separate phase):**
- The **IP-based middleware layer** (`POST /auth/login`, `GET /movies`). No `DEFERRED` marker exists on
  either route today, and no middleware directory exists yet — this is new ground, not an unblock of
  something already marked. Left for a follow-up phase so this one stays scoped to what's already
  waiting.

## Why the guard-only scope (not the full architecture.md table this phase)

`architecture.md`'s Rate Limiting Layer section documents two independent layers — IP middleware and
per-user guard — but only the per-user side has anything actually blocked on it right now (the
`DEFERRED(phase-8)` markers). Building the IP middleware layer at the same time would mean designing
unauthenticated-request handling (an app-wide `NestModule.configure()` middleware registration, a new
concern this codebase hasn't touched yet) for two routes that aren't waiting on anything. Splitting keeps
this phase's diff reviewable and lets the IP layer get its own focused design when it's actually needed.

## Rate limit rules applied this phase

| Route | Limit | Window | Key |
|---|---|---|---|
| `POST /reservations` | 3 | 1 min | `reservations:create` |
| `PATCH /users/me` | 10 | 1 hour | `users:name` |
| `POST /users/me/email` | 10 | 1 hour | `users:email-request` |
| `POST /users/me/email/confirm` | 10 | 1 hour | `users:email-confirm` |
| `GET /users/me/email/pending` | 10 | 1 hour | `users:email-pending` |
| `POST /users/me/password` | 10 | 1 hour | `users:password` |

The 5 `users.controller.ts` routes all share the single `PUT /user/settings` rule from `architecture.md`
(10/1hour) applied uniformly — that's the one rule the doc actually specifies, and splitting it
unevenly across routes would be inventing distinctions the doc doesn't make. `GET
/users/me/email/pending` is a read, but it's included at the same limit rather than left unlimited,
since architecture.md's key pattern (`rate_limit:user:{user_id}:{endpoint}`) doesn't carve out reads and
a uniform rule is simpler to reason about than a carve-out for one route.

**Redis key pattern** (matches `architecture.md`'s existing `rate_limit:user:{user_id}:{endpoint}`):
`rate_limit:user:{userId}:{key}`, where `{key}` is the explicit string from the table above — not the
raw URL, so the key stays stable even if a route's path changes later.

## RateLimiterService corrections

`backend/src/redis/rate-limiter.service.ts` already implements a Redis sorted-set sliding-window
limiter, but has two bugs that must be fixed before anything can safely depend on its output:

1. **Rejected requests are still recorded.** The existing `zadd` runs unconditionally in the same
   pipeline as the count check, before the `allowed` decision is made. A client that keeps retrying
   after being blocked keeps adding fresh entries to its own sliding window, which can keep the block
   alive indefinitely instead of it expiring naturally.
2. **`resetAfterMs` is a placeholder.** It's hardcoded to `config.windowSize` in both the allowed and
   blocked branches — the existing `// TODO: Get an accurate retry in ms` comment already flags this.
   The guard's `Retry-After` header (see below) needs a real value.

**Fix:** move the whole check-and-record operation into one Redis Lua script (`EVAL`), so the count
check and the record happen as a single atomic unit — no other command (from a concurrent request) can
run in between, so there's no window where two concurrent requests could both read "under the limit"
and both get admitted.

Replace `rateLimiter()` entirely:

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

This is a full-file replacement (the class shape, constructor, and public API are unchanged — only
`rateLimiter()`'s body and the module-level script constant are new), so the existing `RateLimiterConfig`
/ `RateLimiterResult` interfaces and every current caller-facing contract stay the same.

## Components

```
backend/src/common/
├── decorators/
│   └── rate-limit.decorator.ts   # @RateLimit({ points, duration, key })
└── guards/
    └── rate-limit.guard.ts       # RateLimitGuard
```

### `rate-limit.decorator.ts`

Mirrors `roles.decorator.ts` exactly:

```ts
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

### `rate-limit.guard.ts`

Mirrors `roles.guard.ts`'s shape (`Reflector` + metadata + throw-on-violation):

```ts
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

No module wiring needed — `Reflector` and `RateLimiterService` are both resolvable application-wide
today (`Reflector` from Nest core, `RateLimiterService` exported by the `@Global()` `RedisModule`),
the same way the existing `RolesGuard` needs no provider registration anywhere.

## Applying the guard

**`reservations.controller.ts`** — method-level only, on `reserve()` (not `listMine`/`cancel`):

```ts
  // Resolves the phase-8 rate-limit marker: 3 reservation attempts / 1 min per user.
  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 3, duration: 60_000, key: 'reservations:create' })
  reserve(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservationsService.reserve(user.id, dto);
  }
```

(Removes the existing `// DEFERRED(phase-8): per-user rate limit (3 / 1 min) on this route.` comment.)

**`users.controller.ts`** — `RateLimitGuard` added at class level (alongside the existing
`@UseGuards(JwtAuthGuard)`); each route keeps its own `@RateLimit(...)`:

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

(Removes all 5 existing `// DEFERRED(phase-8): ...` comments, including the longer one above
`changePassword` that discusses the architecture.md mapping — this phase *is* that mapping.)

## Error handling

| Case | Status | Notes |
|---|---|---|
| Under the limit | 200 (route's normal response) | — |
| Over the limit | 429 | `HttpException('Too many requests, please try again later', HttpStatus.TOO_MANY_REQUESTS)`, with a `Retry-After` header (seconds, from `resetAfterMs`) |
| No `@RateLimit` metadata on a route | 200 (unlimited) | Guard returns `true` immediately |

## Testing (TDD)

- **`RateLimiterService.rateLimiter`**: mock the Redis client's `eval` method.
  - Under the limit → `eval` called with the script + correct `KEYS`/`ARGV`; returns `{ allowed: true,
    remaining, resetAfterMs }` mapped from the script's `[1, remaining, resetAfterMs]` reply.
  - Over the limit → returns `{ allowed: false, remaining: 0, resetAfterMs }` mapped from `[0, 0,
    resetAfterMs]`.
- **`RateLimitGuard`** (new spec, unlike the untested `RolesGuard` — this one has real logic worth
  protecting):
  - No `@RateLimit` metadata → `canActivate` resolves `true`, `RateLimiterService.rateLimiter` never
    called.
  - Metadata present, `rateLimiter` resolves `allowed: true` → `canActivate` resolves `true`.
  - Metadata present, `rateLimiter` resolves `allowed: false` → throws `HttpException` with status 429;
    `response.setHeader('Retry-After', ...)` called with the ceil-seconds value.
- **Controller wiring** (`reservations.controller.spec.ts`, `users.controller.spec.ts`): guard-metadata
  checks via `Reflect.getMetadata('__guards__', ...)`, matching the existing convention — method-level
  target for `ReservationsController.prototype.reserve`, class-level target for `UsersController`.

## Companion changes to `architecture.md`

None needed — the Rate Limiting Layer section (§5) already documents the rules and key pattern this
phase implements; no correction to that section is required. (The IP middleware half of §5 remains
correct as documentation for the deferred follow-up phase.)

## Follow-ups noted for later phases

- **IP-based middleware layer** (`POST /auth/login`, `GET /movies`) — a separate phase: needs a new
  `NestModule.configure()` middleware registration (no precedent in this codebase yet), keyed on
  `rate_limit:ip:{ip_address}:{endpoint}` per `architecture.md`.
- **TOCTOU-adjacent follow-up:** none — the Lua script closes the race this phase was concerned about.
  If `RateLimiterService` ever needs to shave Redis bandwidth under heavy traffic, switch `eval` to
  `defineCommand` + `EVALSHA` (flagged inline as a `ponytail:` comment in the service).
