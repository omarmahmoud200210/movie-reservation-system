# Observability Module — Metrics + Dashboards Design

**Goal:** Give this system real, queryable numbers in Grafana — HTTP traffic health, the reservation and
payment funnels, and WebSocket activity — as the first piece of the Observability phase
(`architecture.md`'s Phase 10). This is the first monitoring work done on this system.

**Why split from logging/alerting:** Observability decomposes into three largely independent subsystems —
metrics/dashboards, structured logging, and alerting. They're sequenced metrics → logging → alerting:
metrics ships fastest and is immediately useful on its own; alerting needs real metrics history to tune
thresholds against, so building it first would mean guessing at values. Logging and alerting each get
their own spec once this one ships.

**Out of scope:** structured logging (pino/winston), Prometheus Alertmanager / Grafana alerting rules,
multi-instance or highly-available Prometheus (a single instance is more than sufficient at this system's
current scale).

---

## Library & Module

**`@willsoto/nestjs-prometheus`** (wraps `prom-client`) — the standard NestJS-idiomatic wrapper: register
metrics as injectable providers via `PrometheusModule.forRoot()` and `makeCounterProvider`/
`makeHistogramProvider`/`makeGaugeProvider`, matching this codebase's existing DI-first patterns (the same
shape as `RedisModule`'s providers).

**`backend/src/metrics/metrics.module.ts`** (new) — `@Global()`, so any service anywhere can `@InjectMetric(...)`
a counter/histogram/gauge without an explicit module import, exactly like `PaymentAbuseService` is
reachable today without importing `RedisModule`. Registers:
- `PrometheusModule.forRoot({ defaultMetrics: { enabled: true } })` — free Node.js process metrics
  (event-loop lag, heap, GC pauses, CPU) via `prom-client`'s `collectDefaultMetrics`, no extra code.
- The library's built-in `GET /metrics` controller, deliberately mounted **outside** the app's `api/v1`
  global prefix (Prometheus convention is an unprefixed `/metrics`; this also means it isn't accidentally
  covered by any `api/v1`-scoped guard/middleware).
- Every custom Counter/Histogram/Gauge provider listed below.

---

## HTTP Metrics

**`backend/src/common/interceptors/metrics.interceptor.ts`** (new) — registered globally via an
`APP_INTERCEPTOR` provider in `AppModule` (not `app.useGlobalInterceptors()` in `main.ts`, so it's part of
the DI graph and testable like any other provider). Wraps every request and records:
- `http_requests_total{method, route, status_code}` — Counter.
- `http_request_duration_seconds{method, route, status_code}` — Histogram, default `prom-client` bucket
  boundaries are fine to start.

The `route` label uses Express's matched route pattern (`req.route?.path`, e.g. `/movies/:id`), **not** the
raw URL — using the raw URL would create one time-series per distinct movie/screening/reservation id
requested, which is a well-known Prometheus cardinality footgun.

---

## Business Metrics

Each wired at the seam that already exists for that state transition — no new event plumbing invented
purely for metrics.

**Reservations** — `backend/src/reservations/listeners/reservation-metrics.listener.ts` (new), a sibling to
the existing `ReservationCacheListener`/`ReservationBroadcastListener`, subscribed to the same
`RESERVATION_CREATED`/`RESERVATION_CANCELLED`/`RESERVATION_CONFIRMED` events:
- `reservations_created_total` — Counter, `.inc()` on `RESERVATION_CREATED`.
- `reservations_cancelled_total` — Counter, `.inc()` on `RESERVATION_CANCELLED`.
- `reservations_confirmed_total` — Counter, `.inc()` on `RESERVATION_CONFIRMED`.
- `reservations_held_current` — Gauge, `.inc()` on `RESERVATION_CREATED`, `.dec()` on both
  `RESERVATION_CANCELLED` and `RESERVATION_CONFIRMED` (a HELD reservation always exits to exactly one of
  those two events, so the gauge stays accurate without a periodic DB recount).

**Payments** — no dedicated event bus exists for payment-status transitions today (only reservation events
do), so these are injected directly into `PaymentsService` at the exact call sites that already set each
status — adding a payments event bus solely to decouple metrics would be speculative infrastructure for a
need that doesn't otherwise exist yet:
- `payments_succeeded_total` — Counter, `.inc()` in `handleCheckoutCompleted`'s paid branch and in
  `reconcileTimedOutPayments`'s paid branch.
- `payments_failed_total` — Counter, `.inc()` in `handleAsyncPaymentFailed`.
- `payments_declined_total` — Counter, `.inc()` in `reconcileTimedOutPayments`'s declined branch.
- `payments_timed_out_total` — Counter, `.inc()` in `handleCheckoutExpired`.
- `payments_refunded_total` — Counter, `.inc()` in `refundReservation` (only on the branch that actually
  sets `REFUNDED`, not on the already-refunded idempotent short-circuit).
- `payment_abuse_lockouts_total` — Counter, `.inc()` inside `PaymentAbuseService.recordFailure`'s
  threshold-crossed branch (the same `if (count >= FAILURE_THRESHOLD)` that sets the lockout key).

**WebSocket/gateway** — `backend/src/gateway/screening.gateway.ts` and
`backend/src/gateway/reservation-broadcast.listener.ts` (both modified, not new files):
- `websocket_connections_current` — Gauge, `.inc()` in `handleConnection`, `.dec()` in `handleDisconnect`.
- `websocket_room_joins_total` — Counter, `.inc()` in `handleJoin` (only on the `{ok: true}` success path).
- `websocket_broadcasts_total{event}` — Counter, one line added inside `ReservationBroadcastListener`'s
  private `broadcast()` method, labeled by the event name (`seat:reserved`/`seat:booked`/`seat:cancelled`),
  so it counts once per broadcast type rather than needing three separate counters.

---

## Prometheus + Grafana (Docker Compose)

**`backend/docker-compose.monitoring.yml`** (new) — deliberately separate from `docker-compose.yml` (dev
Redis) and `docker-compose.test.yml` (e2e Postgres+Redis), so monitoring can be started independently of
either:
- `prometheus` — official image, config from a checked-in `backend/monitoring/prometheus.yml`.
- `grafana` — official image, provisioned (not click-ops) via a checked-in datasource YAML
  (`backend/monitoring/grafana/datasources/prometheus.yml`) pointing at the `prometheus` service, plus one
  dashboard JSON (`backend/monitoring/grafana/dashboards/movie-reservation-system.json`) auto-loaded via
  Grafana's dashboard-provisioning config.

**The one non-obvious wiring detail:** this repo's NestJS app is not itself containerized (it runs via
`npm run start:dev` on the host, per this project's existing dev workflow), so Prometheus's scrape target
in `prometheus.yml` must be `host.docker.internal:3000` — Docker Desktop's standard host-reachable
hostname — not `localhost:3000` (which from inside the Prometheus container means the container itself)
and not a Docker Compose service name (there is no app service in this compose file to resolve).

**Dashboard scope (v1, one consolidated dashboard):**
1. HTTP — request rate, p50/p95/p99 latency, error rate (4xx/5xx), broken out by route.
2. Reservations funnel — created/cancelled/confirmed rates, current HELD gauge.
3. Payments funnel — succeeded/failed/declined/refunded/timed-out rates, abuse-lockout count.
4. WebSocket activity — current connections, room-join rate, broadcast rate by event type.
5. Node process health — from the default metrics: heap usage, event-loop lag, CPU.

---

## Security

`GET /metrics` is **unauthenticated** — standard Prometheus practice, since a scrape target can't
participate in a login flow. Isolation is via Docker networking, not an app-level guard: nothing in
`docker-compose.monitoring.yml` publishes the app's own port, and the app doesn't run inside that compose
network at all — Prometheus reaches it purely via the host, the same way any tool running directly on the
host machine would. If this ever needs tightening (e.g. before a real deployment), a shared-secret header
guard on just this route is the natural next step, but isn't needed for local/dev monitoring.
