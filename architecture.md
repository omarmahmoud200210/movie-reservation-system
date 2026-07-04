# Movie Reservation System — Architecture Plan

## Project Overview

A full-stack movie reservation system built with NestJS, PostgreSQL, Redis, and WebSockets.  
Designed for scale: Redis Pub/Sub bridge, dual Redis instances, WebSocket rooms per screening.

---

## System Components

### 1. Database Layer (PostgreSQL)

**Entities & Relationships**

| Entity | Key Fields | Notes |
|---|---|---|
| `users` | id, email, password_hash, created_at | email has UNIQUE constraint + index |
| `movies` | id, title, description, duration_mins, poster_url | rarely changes — cache aggressively |
| `halls` | id, name, capacity | static data |
| `seats` | id, hall_id, row, number | belongs to hall, not screening |
| `screenings` | id, movie_id, hall_id, starts_at, status | status: scheduled / completed / cancelled |
| `reservations` | id, user_id, seat_id, screening_id, status, held_until | core join entity |

**Reservation Status Enum**
```
pending → held → confirmed
                → cancelled
```

**Critical Indexes**
```sql
-- Authentication
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- Reservation lookups
CREATE INDEX idx_reservations_user_id ON reservations(user_id);
CREATE INDEX idx_reservations_screening_id ON reservations(screening_id);
CREATE INDEX idx_reservations_seat_id ON reservations(seat_id);

-- Screening lookups
CREATE INDEX idx_screenings_movie_id ON screenings(movie_id);
CREATE INDEX idx_screenings_starts_at ON screenings(starts_at);

-- Last line of defense against double-booking
CREATE UNIQUE INDEX idx_no_double_booking
  ON reservations(seat_id, screening_id)
  WHERE status = 'held' OR status = 'confirmed';
```

**Concurrency Strategy**
- Isolation level: Repeatable Read
- Locking: `SELECT FOR UPDATE` on seat row at reservation time
- Flow: read seat status (locked) → check available → insert reservation → commit

---

### 2. Caching Layer (Redis Instance 1)

| Cache Key | Value | TTL | Invalidation |
|---|---|---|---|
| `movie:{id}` | Movie details JSON | 1 hour | On admin update |
| `seat_map:screening:{id}` | Array of { seat_id, status } | 5 min (cold) / no cache (active) | On every reservation event |
| `reservation_history:user:{id}` | Array of reservations | 30 min | On reserve / cancel |

**Active vs Cold Screening Rule**  
A screening is "active" if `starts_at` is within the next 2 hours.  
Active screenings → skip cache, always read from DB with lock.  
Cold screenings → serve seat map from Redis.

---

### 3. Real-Time Layer (WebSocket Gateway)

**Protocol:** Socket.io over WSS
**Room naming:** `screening:{screening_id}`

**Access:** Public and read-only. Every visitor — logged in or not — can
connect and receive live seat/summary updates. There is no WS authentication:
the only mutating action (reserve/cancel) happens over the already-guarded
HTTP API, so there is nothing on the socket to authorize. (A prior version of
this doc specified a hard `WsJwtGuard` on every connection — dropped because
the seat map is already public over HTTP, and gating its live version would
be inconsistent. Socket identity returns in the pub/sub phase below, for
per-holder targeting only.)

**Event Contract**

| Event | Direction | Payload |
|---|---|---|
| `join:screening` | Client → Server | `{ screening_id }`, ack response: `{ ok: true, seats, summary }` or `{ ok: false, error }` |
| `seat:reserved` | Server → Room | `{ screening_id, seat_ids, status: 'HELD' }` |
| `seat:cancelled` | Server → Room | `{ screening_id, seat_ids, status: 'AVAILABLE' }` |
| `screening:summary` | Server → Room | `{ screening_id, capacity, held, booked, available, reserved }` |

`join:screening` returns the initial seat map + summary via its **ack
callback**, tying the response to that specific request — no separate
`seat:initial_state` emit and no ambiguous global `error` event.

**Summary derivation**
`screening:summary` is not a separate Redis counter — it's derived on every
broadcast from the same cache-aside seat map (`seat_map:screening:{id}`) the
HTTP seat-map endpoint already uses, so it can never drift from it. Revisit
with an atomic Redis counter only if load testing (phase 11) shows this
recompute is a real hotspot.

**Reconnection Flow**
Socket.io auto-reconnects with exponential backoff.
On every `connect` event (first connect + reconnects), client re-emits
`join:screening` and gets a fresh ack — full resync, no server-side state to
recover.

---

### 4. Pub/Sub Layer (Redis Instance 2)

**Purpose:** Bridge between the Cron Service and the WebSocket Gateway.

**Channels**

| Channel | Publisher | Subscriber | Payload |
|---|---|---|---|
| `seat:hold_expired` | Cron Service | WS Gateway | `{ seat_id, screening_id, user_socket_id }` |
| `seat:status_changed` | Reservation Service | WS Gateway | `{ seat_id, screening_id, status }` |

**Flow**
```
CronService (every 1 min)
  → finds holds where held_until < NOW() and status = 'held'
  → updates DB status to 'available'
  → PUBLISH to Redis channel 'seat:hold_expired'

WS Gateway (subscribed)
  → receives message
  → emits 'seat:hold_expired' to room screening:{id}  [everyone]
  → emits direct notification to holder's socket        [only holder]
  → invalidates Redis cache key seat_map:screening:{id}
```

---

### 5. Rate Limiting Layer

**Two-layer approach using Redis Instance 1**

| Layer | Limits by | Implementation |
|---|---|---|
| Middleware | IP address | Runs before NestJS routing — blocks anonymous abuse |
| Guard | User ID | Runs after JWT validation — blocks authenticated abuse |

**Rate Limit Rules**

| Endpoint | Limit | Window |
|---|---|---|
| `POST /auth/login` | 5 attempts | 15 min |
| `POST /reservations` | 3 attempts | 1 min |
| `PUT /user/settings` | 10 updates | 1 hour |
| `GET /movies` | 60 requests | 1 min |

**Redis Key Pattern**
```
rate_limit:ip:{ip_address}:{endpoint}
rate_limit:user:{user_id}:{endpoint}
```

---

### 6. Scheduled Jobs (Cron Service)

Lives inside the NestJS app using `@nestjs/schedule`.

| Job | Schedule | Responsibility |
|---|---|---|
| `expireHolds` | Every 1 min | Find held_until < NOW() → release seat → publish to Pub/Sub |
| `completeScreenings` | Every 15 min | Find screenings past starts_at + duration → mark completed |

---

### 7. API Layer (NestJS REST)

**Modules**

| Module | Endpoints |
|---|---|
| AuthModule | POST /auth/register, POST /auth/login, POST /auth/logout |
| MoviesModule | GET /movies, GET /movies/:id, GET /movies/:id/screenings |
| ScreeningsModule | GET /screenings/:id/seats |
| ReservationsModule | POST /reservations, DELETE /reservations/:id, GET /reservations/me |
| UsersModule | GET /users/me, PUT /users/settings |

---

## Infrastructure Diagram

```
Client (Browser / Mobile)
        │
        │  HTTPS / WSS (TLS)
        ▼
   Nginx (Reverse Proxy)
        │
        ├──────────────────────────────┐
        │                              │
        ▼                              ▼
  NestJS HTTP API            NestJS WS Gateway
  (REST endpoints)           (Socket.io rooms)
        │                              │
        ├──── PostgreSQL               │
        │     (source of truth)        │
        │                              │
        ├──── Redis #1 ────────────────┤
        │     (cache + rate limits)    │
        │                              │
        └──── Redis #2 ───────────────►│
              (pub/sub bridge)    subscribes
```

---

## Security Checklist

- [ ] HTTPS / WSS enforced — TLS certificate via Let's Encrypt or Cloudflare
- [ ] JWT stored in httpOnly cookies (not localStorage)
- [x] WebSocket gateway is intentionally public/read-only — no `WsJwtGuard` (see §3); socket identity is added in the pub/sub phase for per-holder targeting only, not for authorization
- [ ] User identity always from JWT, never from client payload
- [ ] Rate limiting on all sensitive endpoints
- [ ] Unique constraint on (seat_id, screening_id) in DB
- [ ] Input validation via class-validator on all DTOs
- [ ] SQL injection prevention via Prisma/TypeORM parameterized queries

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Runtime | Node.js + NestJS |
| Database | PostgreSQL + Prisma |
| Cache | Redis (ioredis) |
| Pub/Sub | Redis (separate instance) |
| Real-time | Socket.io (WSS) |
| Scheduler | @nestjs/schedule |
| Auth | JWT + bcrypt |
| Rate Limiting | Custom Middleware + Guard + Redis |
| Reverse Proxy | Nginx |

---

---

### 8. Payment Layer (Stripe)

**Payment Status Enum**
```
pending → in_progress → succeeded
                     → declined
                     → timed_out → [cron reconciliation] → succeeded
                                                         → failed
```

**`payments` Table**
```sql
id                  uuid primary key
reservation_id      FK → reservations
user_id             FK → users
amount              integer           -- in cents/piastres, NEVER floats
currency            varchar           -- 'usd', 'egp'
status              enum              -- pending, in_progress, succeeded, declined, timed_out, failed
stripe_payment_id   varchar
stripe_session_id   varchar
stripe_event_id     varchar UNIQUE    -- idempotency key against duplicate webhooks
refund_id           varchar
refunded_at         timestamp
disputed            boolean default false
dispute_reason      text
disputed_at         timestamp
created_at          timestamp
updated_at          timestamp
```

**Cancellation & Refund Flow**
```
User cancels → DB transaction:
  reservation.status = 'cancelled'
  payment.refund_id = stripe_refund_id
  payment.refunded_at = NOW()
→ Stripe.refunds.create({ payment_intent_id, amount: calculated })
→ invalidate Redis: seat_map:screening:{id}, reservation_history:user:{id}
→ emit seat:cancelled to WebSocket room
```

**Refund Policy Table**
```sql
CREATE TABLE refund_policies (
  id              uuid primary key,
  hours_before    integer,   -- hours before screening
  refund_percent  integer    -- 100, 50, 0
);

-- Default policy
INSERT INTO refund_policies VALUES
  (gen_random_uuid(), 48, 100),  -- >48hrs  → full refund
  (gen_random_uuid(), 24, 50),   -- 24-48hrs → 50% refund
  (gen_random_uuid(), 0,  0);    -- <24hrs  → no refund
```

**Webhook Security (no rate limiting — signature verification instead)**
```
POST /payments/webhook
  → 1. Stripe signature verification   (stripe.webhooks.constructEvent)
  → 2. Idempotency check               (stripe_event_id already in DB?)
  → 3. Process payment event
```

**Payment Confirmation Flow (success page)**
```
User lands on /reservations/success?session_id=...
→ frontend shows "confirming your booking..." spinner
→ polls GET /reservations/:id/status every 2s (max 5 retries)
→ webhook arrives → DB updates → poll returns confirmed → show confirmation
```

**Cron: Payment Reconciliation**
```
Every 5 min → find payments where status = 'timed_out' AND created_at < NOW() - 10min
→ call Stripe API to check actual status
→ update DB accordingly → trigger refund or confirmation flow
```

---

### 9. Observability Stack

**Stack: Artillery + Prometheus + Grafana**

```
NestJS → /metrics endpoint (Prometheus format)
Prometheus → scrapes /metrics every 15s → stores time-series
Grafana → reads Prometheus → live dashboards during load tests
```

**Package:** `@willsoto/nestjs-prometheus`

**Key Metrics to Watch**

| Priority | Metric | Why |
|---|---|---|
| 1 | HTTP response time (p95) | Top-level signal — check engine light |
| 2 | DB query duration | Catches `SELECT FOR UPDATE` queue buildup |
| 3 | Event loop lag | Detects WebSocket broadcast saturation |
| 4 | DB connection pool usage | Often the real bottleneck under hot writes |
| bonus | Redis hit rate | Detects cache layer failures |

**Artillery Test Scenarios**

Scenario 1 — Mixed read/write load:
```yaml
phases:
  - duration: 60
    arrivalRate: 50
scenarios:
  - flow:
    - get: { url: "/movies" }
    - get: { url: "/screenings/1/seats" }
    - post:
        url: "/reservations"
        json: { seat_id: "{{seatId}}", screening_id: 1 }
```

Scenario 2 — Hot write contention (most important):
```yaml
scenarios:
  - flow:
    - post:
        url: "/reservations"
        json: { seat_id: "B7", screening_id: 1 }
# 100 users → same seat → tests SELECT FOR UPDATE + unique constraint
```

---

---

## Design Patterns & Code Structure

### Patterns Used

| Pattern | Where | Why |
|---|---|---|
| Repository | Every entity | Separates DB queries from business logic |
| Service Layer | Every module | Business logic lives in one place |
| DTO + Validation | Every endpoint | Input safety, strips unexpected fields |
| Strategy | Refund calculation | No if/else chains, easily extendable |
| Observer | Reservation events | Decouples WebSocket, cache, payment concerns |
| Interceptor | Global | Consistent response shape + request logging |

---

### Layer Responsibilities

```
Controller   →  validates input, handles HTTP concerns only
Service      →  business rules, orchestrates repositories
Repository   →  DB queries only, no business logic
```

---

### Repository Pattern

Each entity gets its own repository class. DB logic never leaks into services.

```typescript
@Injectable()
export class ReservationRepository {
  async findSeatWithLock(seatId: string) {
    return this.prisma.$queryRaw`
      SELECT * FROM seats WHERE id = ${seatId} FOR UPDATE
    `
  }
}
```

Repositories: `UserRepository`, `ReservationRepository`, `ScreeningRepository`, `PaymentRepository`

---

### Observer Pattern — Reservation Events

`ReservationService` fires an event and moves on. Each concern listens independently.

```typescript
// Emit (ReservationService)
this.eventEmitter.emit('reservation.confirmed', { seat_id, screening_id })

// Listen (WebSocket, Cache, Payment each have their own listener)
@OnEvent('reservation.confirmed')
async handleConfirmed(payload) {
  await this.gateway.broadcastToRoom(payload.screening_id, 'seat:reserved', payload)
}
```

Package: `@nestjs/event-emitter`

---

### Strategy Pattern — Refund Calculation

```typescript
interface RefundStrategy {
  calculate(amount: number): number
}

class FullRefundStrategy    implements RefundStrategy { calculate(a) { return a } }
class PartialRefundStrategy implements RefundStrategy { calculate(a) { return a * 0.5 } }
class NoRefundStrategy      implements RefundStrategy { calculate(a) { return 0 } }
```

`PaymentService` picks the right strategy based on `screening.starts_at - NOW()` vs `refund_policies` table. No giant if/else chains.

---

### DTO + Validation (Global)

```typescript
// main.ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
```

`whitelist: true` strips any extra fields the client sends before they reach the service.

---

### Folder Structure

```
src/
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── guards/
│   │   ├── jwt.guard.ts
│   │   └── ws-jwt.guard.ts
│   └── dto/
│       ├── login.dto.ts
│       └── register.dto.ts
├── reservations/
│   ├── reservations.module.ts
│   ├── reservations.controller.ts
│   ├── reservations.service.ts
│   ├── reservations.repository.ts
│   ├── listeners/
│   │   ├── cache.listener.ts
│   │   └── websocket.listener.ts
│   └── dto/
│       ├── create-reservation.dto.ts
│       └── cancel-reservation.dto.ts
├── payments/
│   ├── payments.module.ts
│   ├── payments.service.ts
│   ├── payments.repository.ts
│   ├── strategies/
│   │   ├── full-refund.strategy.ts
│   │   ├── partial-refund.strategy.ts
│   │   └── no-refund.strategy.ts
│   └── webhook/
│       └── stripe-webhook.handler.ts
├── movies/
├── screenings/
├── users/
├── gateway/
│   └── screening.gateway.ts
├── cron/
│   └── cron.service.ts
├── cache/
│   └── cache.service.ts
├── common/
│   ├── interceptors/
│   │   ├── response-transform.interceptor.ts
│   │   └── logging.interceptor.ts
│   ├── middleware/
│   │   └── rate-limit.middleware.ts
│   └── guards/
│       └── rate-limit.guard.ts
└── main.ts
```

---

## Build Order (Recommended)

1. **Database** — schema, migrations, seed data (movies, halls, seats, refund policies) ✅
2. **Auth** — register, login, JWT guard ✅
3. **Movies + Screenings** — read endpoints with caching ✅
4. **Reservations (HTTP)** — reserve, cancel with `SELECT FOR UPDATE` ✅
5. **WebSocket Gateway** — rooms, initial state, authentication 
6. **Cron Jobs** — hold expiry, screening completion, payment reconciliation 
7. **Redis Pub/Sub bridge** — connect cron to gateway
8. **Rate Limiting** — middleware + guard
9. **Payment** — Stripe checkout, webhook handler, refund logic
10. **Observability** — Prometheus metrics, Grafana dashboards
11. **Load Testing** — Artillery scenarios, tune under Grafana observation
12. **Security hardening** — HTTPS, input validation, JWT in cookies
13. **Integration Wiring** — walk every `DEFERRED(phase-N)` marker across all
    modules and connect each seam to the module that now exists. Earlier phases
    intentionally leave greppable `// DEFERRED(phase-N): …` comments (no stub
    code) exactly where a not-yet-built module will plug in; this phase is the
    single deliberate pass that closes them all. Find them with
    `grep -rn "DEFERRED(phase-" backend/src`. Known seams so far:
    - Reservations → WebSocket broadcast (phase 5, ✅ resolved when phase 5 ships)
    - Reservations → Cron hold-expiry consuming `heldUntil` (phase 6)
    - Gateway → Redis Pub/Sub `seat:hold_expired` + per-holder notification (phase 7)
    - Reservations `POST` → rate limiting (phase 8)
    - Reservations / Gateway → `HELD → CONFIRMED` / `BOOKED` on payment (phase 9)
    - Gateway `getScreeningSummary` → atomic Redis counters if load testing warrants (phase 11)


## Notes for later

- **TODO (e2e tests for OAuth guards):** controller unit tests call methods directly and bypass the guard pipeline, so guard logic (`GoogleLinkAuthGuard.getAuthenticateOptions`, redirect legs) has no automated coverage. Add e2e tests (supertest) for `/auth/google/callback` and `/auth/link-google/callback` with the Google strategy stubbed — these are the only tests that exercise `canActivate`/`getAuthenticateOptions`. Motivating bug: `getAuthenticateOptions` runs on *both* the initiation and callback legs; on the callback `req.user` is undefined (no `JwtAuthGuard` there), so an unguarded `user!.id` threw a runtime `TypeError` that every unit test passed straight through.