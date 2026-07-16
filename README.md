# 🎬 Movie Reservation System

A high-performance movie seat reservation backend built to explore real-world concurrency, scalability, and payment integration challenges under heavy traffic.

> **Goal:** What happens to the system under high traffic? Will it survive? How should I think about scalability and performance?

## Architecture

```
Client → NestJS API (api/v1) → PostgreSQL (source of truth)
  ↕ WSS                       ↗ Redis (cache + rate limiting + OTP)
Socket.IO rooms              → EventEmitter (decoupled side-effects)
                             → Stripe (payments + webhooks)
                             → Prometheus → Grafana (observability)
```

## Tech Stack

| Layer           | Technology                         |
| :-------------- | :--------------------------------- |
| Framework       | NestJS                             |
| Database        | PostgreSQL 16                      |
| ORM             | Prisma                             |
| Cache & Queues  | Redis 7 (ioredis)                  |
| Payments        | Stripe (Checkout Sessions)         |
| Real-Time       | Socket.IO                          |
| Auth            | Passport (JWT, Google OAuth, Local)|
| Observability   | Prometheus + Grafana               |
| Testing         | Jest + Testcontainers + Artillery  |
| Infrastructure  | Docker Compose                     |

## Project Structure

```
backend/
├── src/
│   ├── auth/           # Authentication (JWT, Google OAuth, OTP)
│   ├── common/         # Guards, interceptors, middleware, decorators
│   ├── cron/           # Scheduled jobs (hold expiry, payment reconciliation)
│   ├── gateway/        # WebSocket gateway (Socket.IO)
│   ├── mailer/         # Email service (Nodemailer)
│   ├── metrics/        # Prometheus metrics
│   ├── movies/         # Movie CRUD
│   ├── payments/       # Stripe checkout & webhooks
│   ├── prisma/         # Prisma service & schema
│   ├── redis/          # Cache, rate limiter, payment abuse prevention
│   ├── reservations/   # Seat reservation logic (pessimistic locking)
│   ├── screenings/     # Screening management & seat maps
│   └── users/          # User profile management
├── test/               # E2E tests (Testcontainers)
├── load-test/          # Artillery scenarios
├── monitoring/         # Prometheus & Grafana configs
└── prisma/             # Schema & migrations
```

---

## Design Decisions

### Data Integrity

#### 1. Double-Booking Prevention (Pessimistic Locking)

I use pessimistic locking (`SELECT FOR UPDATE`) with `REPEATABLE READ` isolation level combined with a partial unique index (`WHERE status = 'held' OR status = 'confirmed'`) to prevent double bookings.

**Why not optimistic locking?** Because I want to avoid phantom reads and non-repeatable reads. In a seat reservation system, if a user cannot commit a transaction because the seat is already held by someone else, that is the correct behavior — not something we should silently retry. The client handles this case and guides the user to pick another seat.

#### 2. Idempotent Stripe Webhooks

Stripe can send the same webhook event multiple times. The `@unique` constraint on `stripe_event_id` handles duplicates automatically at the database level. The webhook handler does not trust session data from the client — it constructs the event entirely from Stripe's signature-verified payload.

#### 3. Refund Strategy Pattern

I use the Strategy pattern driven by a database table (`refund_policy`). Adding a new refund tier (e.g., 12–24 hours → 75% refund) requires only an `INSERT` into the table — zero code changes.

---

### Security

#### 4. JWT in httpOnly Cookies + Refresh Token Rotation

Access tokens are stored in `httpOnly` cookies to prevent XSS-based token theft. Refresh token rotation ensures that a stolen refresh token can only be used once before it is invalidated.

#### 5. Two-Layer Rate Limiting

1. **Layer 1 — Middleware (IP-based):** Runs before NestJS routing. Blocks anonymous brute-force attacks.
2. **Layer 2 — Guard (User-ID-based):** Runs after JWT validation. Blocks authenticated abuse (e.g., rapid reservation attempts).

#### 6. Payment Abuse Prevention

A Redis-backed sliding window tracks checkout attempts per user. If a user exceeds the threshold, further payment requests are blocked to protect the Stripe gateway from abuse.

#### 7. Network Access Control

The database is configured to only accept connections from the backend server. Configuration is in `backend/ddl/network_access.sql`. In production, the database should live on a private network with no public exposure.

#### 8. Input Validation & Security Hardening

- **Global `ValidationPipe`** with `whitelist` and `forbidNonWhitelisted` strips and rejects unknown fields.
- **Helmet** sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.).
- **CORS** is restricted to the configured frontend origin with credentials enabled.

#### 9. Role-Based Access Control (RBAC)

An `ADMIN` / `USER` role enum with a custom `RolesGuard` restricts admin-only endpoints (e.g., creating movies, managing screenings).

#### 10. Google OAuth + Email Verification (OTP)

Users can register with email/password or sign in with Google OAuth 2.0. Email-only accounts require OTP verification via a Redis-backed, time-limited code sent through Nodemailer.

---

### Performance & Caching

#### 11. Hot Data Indexing

Frequently queried columns (`screening.startTime`, `screening.movieId`, `reservation.screeningId`, `seat.hallId`, etc.) are indexed to keep read latency low under load.

#### 12. Active vs. Cold Screening Cache Strategy

Not everything is cached. Screenings starting within 2 hours ("active") skip the cache entirely and always hit the database with locking — because active screenings have high write contention, and stale cache data would cause immediate double bookings. "Cold" screenings (days away) are heavily cached in Redis, reducing database load by >90%.

#### 13. Redis Atomicity with Lua Scripts

The sliding-window rate limiter uses Lua scripts executed atomically in Redis. This eliminates race conditions that would occur with separate `GET` / `SET` calls in a multi-instance deployment.

#### 14. API Versioning

All endpoints are prefixed with `/api/v1`, enabling non-breaking API evolution when new versions are needed.

---

### Real-Time

#### 15. WebSocket Seat Map (Socket.IO)

- Client joins a screening room → receives the current seat map via the acknowledgment callback.
- Server broadcasts `seat:reserved` / `seat:cancelled` events to the room in real time.
- Reconnection re-syncs automatically — no server-side session state is required.

#### 16. Event-Driven Architecture (Observer Pattern)

When a reservation is created or cancelled, the service emits an event and knows nothing about WebSockets, caching, or payments. Each concern (cache invalidation, WebSocket broadcast, payment trigger) listens independently. Adding a new side-effect (e.g., email notification) requires only adding a listener — zero changes to the reservation service.

---

### Reliability

#### 17. Cron Jobs

Scheduled tasks handle time-dependent cleanup:
- **Expired holds:** Releases seats that were held but never paid for.
- **Payment reconciliation:** Detects and resolves timed-out Stripe sessions.

#### 18. Observability (Prometheus + Grafana)

Prometheus scrapes application metrics (request latency, error rates, active connections, custom business metrics). Grafana provides pre-configured dashboards for real-time monitoring. Configuration is in `backend/monitoring/`.

---

### Testing

#### 19. Unit & Integration Tests (Jest + Testcontainers)

Unit and integration tests run with Jest. E2E tests spin up real PostgreSQL and Redis containers via Testcontainers — no mocking the database layer.

#### 20. Load Testing (Artillery)

Seven Artillery scenarios validate the system under different traffic patterns:

| Scenario              | What It Proves                                              |
| :-------------------- | :---------------------------------------------------------- |
| `mixed-read-write`    | Baseline: 50 req/s mixed reads + writes, p95 < 500 ms      |
| `hot-seat-contention` | 100 users → same seat → exactly 1 wins                     |
| `multi-hot-contention`| 20 hot screenings × 100 users — distributed contention     |
| `ramp-to-failure`     | Finds the breaking point under increasing load              |
| `soak-mixed`          | Stability over extended duration — no memory leaks          |
| `spike-recovery`      | Sharp traffic spike → system recovers gracefully            |
| `checkout-payment`    | Reserve → checkout → Stripe session creation under load     |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Docker** & **Docker Compose**
- **Stripe** account (for payment integration)

### 1. Clone & Install

```bash
git clone https://github.com/omarmahmoud200210/Movie_Reservation_System.git
cd Movie_Reservation_System/backend
npm install
```

### 2. Environment

```bash
cp .env.example .env   # Fill in your secrets (DB URL, Stripe keys, etc.)
```

### 3. Infrastructure

```bash
# Start PostgreSQL + Redis
docker compose up -d

# (Optional) Start Prometheus + Grafana
docker compose -f docker-compose.monitoring.yml up -d
```

### 4. Database Setup

```bash
npx prisma migrate dev
npx prisma db seed
```

### 5. Run

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000/api/v1`.

---

## License

[MIT](./LICENSE) © Omar Mahmoud