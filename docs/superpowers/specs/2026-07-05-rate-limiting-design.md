# Rate Limiting — Design

**Date:** 2026-07-05
**Build order:** Phase 8. Unblocked by the user-settings phase (`2026-07-04-user-settings-design.md`),
which added the `PUT /user/settings` rate-limit rule's real target endpoints.
**Depends on:** Reservations (✅, `POST /reservations` already carries a `DEFERRED(phase-8)` marker),
Users (✅, all 5 routes in `users.controller.ts` carry `DEFERRED(phase-8)` markers), `RateLimiterService`
(✅ exists, gets corrected in this phase — see below).

## Goal

Implement both rate-limiting layers `architecture.md` §5 documents: a per-user guard layer (resolving
every `DEFERRED(phase-8)` marker on `POST /reservations` and the 5 `UsersController` routes) and an
IP-based middleware layer (`POST /auth/login`, `GET /movies` — routes with no logged-in user to key on).
Both reuse the existing (but currently unwired and buggy) `RateLimiterService` rather than adding a new
library.

## Why two layers

The user-guard layer needs `req.user.id` to build its Redis key, which only exists *after*
`JwtAuthGuard` has verified a JWT. That's fine for `POST /reservations` and the users routes — you must
already be logged in to hit them. But `POST /auth/login` and `GET /movies` are the opposite case: there
is no logged-in user yet (that's the point of login) or none is required (movies browsing is public), so
there's no `user.id` to throttle by. The only identifier available for an anonymous caller is their IP
address — hence a separate layer, running as middleware (before routing/guards), keyed by IP instead of
user. Without it, `/auth/login` has no defense against credential stuffing (unlimited password guesses
across made-up or rotating emails) and `/movies` has no defense against high-volume scraping — neither
attack has a `user.id` for the guard layer to see.

## Scope

**In:**
- A `@RateLimit(...)` decorator + `RateLimitGuard` (per-user layer), mirroring the existing
  `@Roles(...)` / `RolesGuard` pattern in `backend/src/common/`. Applied to `POST /reservations`
  (method-level) and all 5 `UsersController` routes (class-level).
- An `IpRateLimitMiddleware` (IP layer), registered via `AppModule`'s `NestModule.configure()`. Applied
  to `POST /auth/login` and `GET /movies` (the `browse()` route only, not `GET /movies/:id`).
- Fixing the two correctness bugs in `RateLimiterService.rateLimiter()` (see "RateLimiterService
  corrections" below) — required before either layer can trust its output.

**Out:**
- Nothing pulled from `architecture.md` §5 is deferred anymore — this phase covers the whole documented
  table.

## Rate limit rules applied this phase

**Per-user (guard layer):**

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

**Per-IP (middleware layer):**

| Route | Limit | Window | Key |
|---|---|---|---|
| `POST /auth/login` | 5 | 15 min | `auth:login` |
| `GET /movies` | 60 | 1 min | `movies:browse` |

Both rules and windows are exactly what `architecture.md` §5 already documents.

**Redis key pattern** (matches `architecture.md`'s existing `rate_limit:ip:{ip_address}:{endpoint}`):
`rate_limit:ip:{req.ip}:{key}`.

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
│   └── rate-limit.decorator.ts     # @RateLimit({ points, duration, key })
├── guards/
│   └── rate-limit.guard.ts         # RateLimitGuard (per-user layer)
└── middleware/
    └── ip-rate-limit.middleware.ts # IpRateLimitMiddleware (per-IP layer)
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

### `ip-rate-limit.middleware.ts`

Unlike a guard, Express-style middleware has no `ExecutionContext` and can't read per-handler
`@RateLimit` metadata via `Reflector` — so its two routes' rules live in a small internal lookup table
instead of decorators. Two routes is little enough that this stays simple; if a third IP-limited route
ever shows up, promoting this to metadata-driven (e.g. attaching rule data via `SetMetadata` and reading
it through a raw Express handler lookup) would be worth it then, not now.

It also can't rely on Nest's exception-filter pipeline the way a guard can (middleware sits in Express's
stack, ahead of where Nest's request-handling machinery takes over), so instead of throwing an
`HttpException`, it writes the 429 response directly:

```ts
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

**On `req.ip`:** this reads the direct connecting client's address. There's no reverse proxy in front of
this app today (no `trust proxy` setting or nginx layer anywhere in the codebase), so that's correct as
is. If this app is ever deployed behind a proxy/load balancer, `app.set('trust proxy', ...)` in
`main.ts` would need to be added then — flagged here rather than solved now, since no such proxy exists
to test against.

**Registering it** — `app.module.ts` gains a `NestModule` implementation:

```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
// ...existing imports...
import { IpRateLimitMiddleware } from './common/middleware/ip-rate-limit.middleware';

@Module({ /* ...existing imports/providers... */ })
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

`forRoutes` paths are relative to each controller's own route (`auth/login`, `movies`), matching what
`AuthController`/`MoviesController` already declare — the global `api/v1` prefix from `main.ts` is
applied on top by Nest and doesn't need repeating here. `{ path: 'movies', method: GET }` matches only
`MoviesController.browse()` (`@Get()` on `@Controller('movies')`), not `GET /movies/:id` — the two are
different path patterns.

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
| Under the limit (either layer) | 200 (route's normal response) | — |
| Over the limit — guard layer | 429 | `HttpException('Too many requests, please try again later', HttpStatus.TOO_MANY_REQUESTS)`, with a `Retry-After` header (seconds, from `resetAfterMs`) |
| Over the limit — middleware layer | 429 | Response written directly (`res.status(429).json({...})`) with the same message shape and a `Retry-After` header — see "On `req.ip`" note above for why it can't just throw |
| No `@RateLimit` metadata on a route (guard layer) | 200 (unlimited) | Guard returns `true` immediately |
| Route not in the `RULES` lookup (middleware layer) | 200 (unlimited) | Middleware calls `next()` immediately |

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
- **`IpRateLimitMiddleware`** (new spec, mocking `RateLimiterService`):
  - Request method/path not in `RULES` → calls `next()`, `RateLimiterService.rateLimiter` never called.
  - Matching rule, `rateLimiter` resolves `allowed: true` → calls `next()`, no response written.
  - Matching rule, `rateLimiter` resolves `allowed: false` → `next()` never called;
    `res.setHeader('Retry-After', ...)` and `res.status(429).json(...)` called with the expected body.
  - Both `RULES` entries (`POST /auth/login`, `GET /movies`) individually resolve to their documented
    `points`/`duration`/`key`.
- **`AppModule.configure`**: a lightweight test asserting `consumer.apply` is called with
  `IpRateLimitMiddleware` and the two expected route matchers (mocking `MiddlewareConsumer`).

## Companion changes to `architecture.md`

None needed — the Rate Limiting Layer section (§5) already documents both layers' rules and key
patterns exactly as implemented here; no correction to that section is required.

## Follow-ups noted for later phases

- **`trust proxy`**: if this app is ever deployed behind a reverse proxy/load balancer, `req.ip` in
  `IpRateLimitMiddleware` would need `app.set('trust proxy', ...)` in `main.ts` to read the real client
  IP instead of the proxy's. No such proxy exists in this codebase today, so not solved now.
- **A third IP-limited route**: `IpRateLimitMiddleware`'s `RULES` lookup is fine for 2 routes; a 3rd
  would be a good trigger to reconsider a metadata-driven approach instead of growing the lookup table.
- **TOCTOU-adjacent follow-up:** none — the Lua script closes the race this phase was concerned about.
  If `RateLimiterService` ever needs to shave Redis bandwidth under heavy traffic, switch `eval` to
  `defineCommand` + `EVALSHA` (flagged inline as a `ponytail:` comment in the service).
