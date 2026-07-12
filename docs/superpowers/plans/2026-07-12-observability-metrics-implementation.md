# Observability Metrics + Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Prometheus metrics + Grafana dashboard work described in
`docs/superpowers/specs/2026-07-12-observability-metrics-design.md` — HTTP metrics, reservation/payment
funnel counters, WebSocket gauges, and a provisioned Grafana dashboard — on top of the `feat/payments-phase9`
branch (metrics wiring touches `PaymentsService`, `ReservationBroadcastListener`, and reservation events,
none of which exist on `main` yet).

**Architecture:** One new `@Global()` `MetricsModule` (`src/metrics/`) registers `@willsoto/nestjs-prometheus`'s
`PrometheusModule` plus every custom Counter/Gauge/Histogram provider. A new global HTTP interceptor covers
request rate/latency. A new reservation-events listener covers the reservation funnel. Existing
`PaymentsService`/`PaymentAbuseService`/`ScreeningGateway`/`ReservationBroadcastListener` each get a small,
targeted diff — a metric injected via `@InjectMetric()` and one `.inc()`/`.dec()` call at the exact line
where that state transition already happens. A new `docker-compose.monitoring.yml` + provisioning files
bring up Prometheus and Grafana pointed at the app running on the host.

**Tech Stack:** `@willsoto/nestjs-prometheus` `^6.1.0` and `prom-client` `^15.1.3` — **both already present
in `package.json`/`node_modules`, unused anywhere in `src/` yet** (verified via `npm ls`) — no install step
needed. Prometheus + Grafana via Docker Compose (official images).

---

## File Structure

**New:**
- `backend/src/metrics/metrics.module.ts` — registers `PrometheusModule` + every custom metric provider.
- `backend/src/common/interceptors/metrics.interceptor.ts` — HTTP request rate/latency.
- `backend/src/common/test/metrics.interceptor.spec.ts`
- `backend/src/reservations/listeners/reservation-metrics.listener.ts` — reservation funnel counters/gauge.
- `backend/src/reservations/test/reservation-metrics.listener.spec.ts`
- `backend/monitoring/prometheus.yml`
- `backend/monitoring/grafana/datasources/prometheus.yml`
- `backend/monitoring/grafana/dashboards/dashboard-provider.yml`
- `backend/monitoring/grafana/dashboards/movie-reservation-system.json`
- `backend/docker-compose.monitoring.yml`

**Modified:**
- `backend/src/app.module.ts` — import `MetricsModule`, register `MetricsInterceptor` as `APP_INTERCEPTOR`.
- `backend/src/reservations/reservations.module.ts` — add `ReservationMetricsListener` to `providers`.
- `backend/src/payments/payments.service.ts` — inject 5 Counters, `.inc()` at each status transition.
- `backend/src/payments/test/payments.service.spec.ts` — mock the 5 injected counters.
- `backend/src/redis/payment-abuse.service.ts` — inject 1 Counter, `.inc()` on lockout.
- `backend/src/redis/test/payment-abuse.service.spec.ts` — mock the injected counter.
- `backend/src/gateway/screening.gateway.ts` — inject a Gauge + Counter, wire connect/disconnect/join.
- `backend/src/gateway/test/screening.gateway.spec.ts` — mock the injected metrics.
- `backend/src/gateway/reservation-broadcast.listener.ts` — inject 1 Counter, `.inc()` per broadcast.
- `backend/src/gateway/test/reservation-broadcast.listener.spec.ts` — mock the injected counter.

---

## Task 1: `MetricsModule`

**Files:**
- Create: `backend/src/metrics/metrics.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write the module**

```typescript
// backend/src/metrics/metrics.module.ts
import { Global, Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

const counters = [
  makeCounterProvider({
    name: 'reservations_created_total',
    help: 'Reservations created',
  }),
  makeCounterProvider({
    name: 'reservations_cancelled_total',
    help: 'Reservations cancelled',
  }),
  makeCounterProvider({
    name: 'reservations_confirmed_total',
    help: 'Reservations confirmed after payment',
  }),
  makeCounterProvider({
    name: 'payments_succeeded_total',
    help: 'Payments that reached SUCCEEDED',
  }),
  makeCounterProvider({
    name: 'payments_failed_total',
    help: 'Payments that reached FAILED (async payment failure)',
  }),
  makeCounterProvider({
    name: 'payments_declined_total',
    help: 'Payments declined during reconciliation',
  }),
  makeCounterProvider({
    name: 'payments_timed_out_total',
    help: 'Checkout sessions that expired without payment',
  }),
  makeCounterProvider({
    name: 'payments_refunded_total',
    help: 'Payments refunded on reservation cancellation',
  }),
  makeCounterProvider({
    name: 'payment_abuse_lockouts_total',
    help: 'Times a user crossed the payment-failure lockout threshold',
  }),
  makeCounterProvider({
    name: 'websocket_room_joins_total',
    help: 'Successful join:screening acks',
  }),
  makeCounterProvider({
    name: 'websocket_broadcasts_total',
    help: 'WebSocket broadcasts emitted, by event type',
    labelNames: ['event'],
  }),
  makeCounterProvider({
    name: 'http_requests_total',
    help: 'HTTP requests, by method/route/status',
    labelNames: ['method', 'route', 'status_code'],
  }),
];

const gauges = [
  makeGaugeProvider({
    name: 'reservations_held_current',
    help: 'Reservations currently in HELD status',
  }),
  makeGaugeProvider({
    name: 'websocket_connections_current',
    help: 'Currently connected WebSocket clients',
  }),
];

const histograms = [
  makeHistogramProvider({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method/route/status',
    labelNames: ['method', 'route', 'status_code'],
  }),
];

/**
 * Global so any module can @InjectMetric(...) without importing this module,
 * matching how RedisModule's PaymentAbuseService is reachable app-wide.
 */
@Global()
@Module({
  imports: [
    PrometheusModule.register({
      global: true,
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [...counters, ...gauges, ...histograms],
  exports: [...counters, ...gauges, ...histograms],
})
export class MetricsModule {}
```

- [ ] **Step 2: Wire it into `AppModule`**

```typescript
// backend/src/app.module.ts
import { MetricsModule } from './metrics/metrics.module';
```

Add `MetricsModule` to the `imports` array (anywhere — e.g. right after `RedisModule`).

- [ ] **Step 3: Verify it boots and exposes `/metrics`**

Run: `cd backend && npm run start:dev`
Then in another terminal: `curl http://localhost:3000/metrics`
Expected: a Prometheus text-format response containing `# HELP reservations_created_total Reservations created`
and `# HELP process_cpu_user_seconds_total ...` (a default metric) somewhere in the output — confirming both
the custom providers and `collectDefaultMetrics` are active. Stop `start:dev` once confirmed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/metrics/metrics.module.ts backend/src/app.module.ts
git commit -m "feat(observability): add MetricsModule (Prometheus registry + custom metrics)"
```

---

## Task 2: HTTP metrics interceptor

**Files:**
- Create: `backend/src/common/interceptors/metrics.interceptor.ts`
- Create: `backend/src/common/test/metrics.interceptor.spec.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/common/test/metrics.interceptor.spec.ts
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { MetricsInterceptor } from '../interceptors/metrics.interceptor';

const mockCounter = { inc: jest.fn() };
const mockHistogram = { observe: jest.fn() };

function mockHttpContext(overrides: {
  method?: string;
  routePath?: string;
  path?: string;
  statusCode?: number;
}): ExecutionContext {
  const request = {
    method: overrides.method ?? 'GET',
    route: overrides.routePath ? { path: overrides.routePath } : undefined,
    path: overrides.path ?? '/movies/1',
  };
  const response = { statusCode: overrides.statusCode ?? 200 };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function handlerThrowing(err: Error): CallHandler {
  return { handle: () => throwError(() => err) };
}

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new MetricsInterceptor(
      mockCounter as never,
      mockHistogram as never,
    );
  });

  it('records the matched route pattern, method, and status on success', async () => {
    const context = mockHttpContext({
      method: 'GET',
      routePath: '/movies/:id',
      statusCode: 200,
    });

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(mockCounter.inc).toHaveBeenCalledWith({
      method: 'GET',
      route: '/movies/:id',
      status_code: '200',
    });
    expect(mockHistogram.observe).toHaveBeenCalledWith(
      { method: 'GET', route: '/movies/:id', status_code: '200' },
      expect.any(Number),
    );
  });

  it('falls back to the raw path when no route pattern matched (e.g. 404)', async () => {
    const context = mockHttpContext({
      method: 'GET',
      routePath: undefined,
      path: '/does-not-exist',
      statusCode: 404,
    });

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(mockCounter.inc).toHaveBeenCalledWith({
      method: 'GET',
      route: '/does-not-exist',
      status_code: '404',
    });
  });

  it('still records metrics when the handler throws', async () => {
    const context = mockHttpContext({
      method: 'POST',
      routePath: '/reservations',
      statusCode: 500,
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(context, handlerThrowing(new Error('boom'))),
      ),
    ).rejects.toThrow('boom');

    expect(mockCounter.inc).toHaveBeenCalledWith({
      method: 'POST',
      route: '/reservations',
      status_code: '500',
    });
  });

  it('skips non-HTTP contexts (e.g. WebSocket) without touching the metrics', () => {
    const context = { getType: () => 'ws' } as unknown as ExecutionContext;

    interceptor.intercept(context, handlerReturning({}));

    expect(mockCounter.inc).not.toHaveBeenCalled();
    expect(mockHistogram.observe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd backend && npx jest metrics.interceptor.spec.ts`
Expected: FAIL — cannot find module `../interceptors/metrics.interceptor`.

- [ ] **Step 3: Implement the interceptor**

```typescript
// backend/src/common/interceptors/metrics.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Histogram } from 'prom-client';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Records HTTP request rate + latency, labeled by the matched route
 * pattern (not the raw URL) so per-id resources don't explode cardinality. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_requests_total')
    private readonly requestsCounter: Counter<string>,
    @InjectMetric('http_request_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    const record = () => {
      const route = request.route?.path ?? request.path;
      const labels = {
        method: request.method,
        route,
        status_code: String(response.statusCode),
      };
      const durationSeconds =
        Number(process.hrtime.bigint() - start) / 1_000_000_000;
      this.requestsCounter.inc(labels);
      this.durationHistogram.observe(labels, durationSeconds);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd backend && npx jest metrics.interceptor.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Register it globally in `AppModule`**

```typescript
// backend/src/app.module.ts
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';
```

Add a `providers` array (this `AppModule` doesn't have one yet) alongside the existing `imports`:

```typescript
@Module({
  imports: [ /* ...unchanged... */ ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule implements NestModule {
  /* ...unchanged... */
}
```

- [ ] **Step 6: Run the full unit suite + build**

Run: `cd backend && npx jest && npx nest build`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/common/interceptors/metrics.interceptor.ts backend/src/common/test/metrics.interceptor.spec.ts backend/src/app.module.ts
git commit -m "feat(observability): add global HTTP metrics interceptor"
```

---

## Task 3: Reservation funnel metrics listener

**Files:**
- Create: `backend/src/reservations/listeners/reservation-metrics.listener.ts`
- Create: `backend/src/reservations/test/reservation-metrics.listener.spec.ts`
- Modify: `backend/src/reservations/reservations.module.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/reservations/test/reservation-metrics.listener.spec.ts
import { ReservationMetricsListener } from '../listeners/reservation-metrics.listener';

const mockCreatedCounter = { inc: jest.fn() };
const mockCancelledCounter = { inc: jest.fn() };
const mockConfirmedCounter = { inc: jest.fn() };
const mockHeldGauge = { inc: jest.fn(), dec: jest.fn() };

describe('ReservationMetricsListener', () => {
  let listener: ReservationMetricsListener;

  beforeEach(() => {
    jest.clearAllMocks();
    listener = new ReservationMetricsListener(
      mockCreatedCounter as never,
      mockCancelledCounter as never,
      mockConfirmedCounter as never,
      mockHeldGauge as never,
    );
  });

  it('handleCreated increments the created counter and the held gauge', () => {
    listener.handleCreated({ screeningId: 3, seatIds: [11] });

    expect(mockCreatedCounter.inc).toHaveBeenCalledTimes(1);
    expect(mockHeldGauge.inc).toHaveBeenCalledTimes(1);
  });

  it('handleCancelled increments the cancelled counter and decrements the held gauge', () => {
    listener.handleCancelled({ screeningId: 3, seatIds: [11] });

    expect(mockCancelledCounter.inc).toHaveBeenCalledTimes(1);
    expect(mockHeldGauge.dec).toHaveBeenCalledTimes(1);
  });

  it('handleConfirmed increments the confirmed counter and decrements the held gauge', () => {
    listener.handleConfirmed({ screeningId: 3, seatIds: [11] });

    expect(mockConfirmedCounter.inc).toHaveBeenCalledTimes(1);
    expect(mockHeldGauge.dec).toHaveBeenCalledTimes(1);
  });

  it('subscribes each handler to the matching reservation event', () => {
    const createdEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCreated,
    ) as Array<{ event: string }>;
    const cancelledEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleCancelled,
    ) as Array<{ event: string }>;
    const confirmedEvents = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      listener.handleConfirmed,
    ) as Array<{ event: string }>;

    expect(createdEvents.map((e) => e.event)).toEqual(['reservation.created']);
    expect(cancelledEvents.map((e) => e.event)).toEqual([
      'reservation.cancelled',
    ]);
    expect(confirmedEvents.map((e) => e.event)).toEqual([
      'reservation.confirmed',
    ]);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd backend && npx jest reservation-metrics.listener.spec.ts`
Expected: FAIL — cannot find module `../listeners/reservation-metrics.listener`.

- [ ] **Step 3: Implement the listener**

```typescript
// backend/src/reservations/listeners/reservation-metrics.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Gauge } from 'prom-client';
import {
  RESERVATION_CANCELLED,
  RESERVATION_CONFIRMED,
  RESERVATION_CREATED,
  type ReservationChangedPayload,
} from '../events/reservation.events';

/** Tracks the reservation funnel. A HELD reservation always exits to exactly
 * one of CANCELLED/CONFIRMED, so the held gauge stays accurate without a
 * periodic DB recount. */
@Injectable()
export class ReservationMetricsListener {
  constructor(
    @InjectMetric('reservations_created_total')
    private readonly createdCounter: Counter<string>,
    @InjectMetric('reservations_cancelled_total')
    private readonly cancelledCounter: Counter<string>,
    @InjectMetric('reservations_confirmed_total')
    private readonly confirmedCounter: Counter<string>,
    @InjectMetric('reservations_held_current')
    private readonly heldGauge: Gauge<string>,
  ) {}

  @OnEvent(RESERVATION_CREATED)
  handleCreated(_payload: ReservationChangedPayload): void {
    this.createdCounter.inc();
    this.heldGauge.inc();
  }

  @OnEvent(RESERVATION_CANCELLED)
  handleCancelled(_payload: ReservationChangedPayload): void {
    this.cancelledCounter.inc();
    this.heldGauge.dec();
  }

  @OnEvent(RESERVATION_CONFIRMED)
  handleConfirmed(_payload: ReservationChangedPayload): void {
    this.confirmedCounter.inc();
    this.heldGauge.dec();
  }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd backend && npx jest reservation-metrics.listener.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Register it in `ReservationsModule`**

```typescript
// backend/src/reservations/reservations.module.ts
import { ReservationMetricsListener } from './listeners/reservation-metrics.listener';
```

Add `ReservationMetricsListener` to the `providers` array, alongside the existing
`ReservationCacheListener`.

- [ ] **Step 6: Run the full unit suite + build**

Run: `cd backend && npx jest && npx nest build`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/reservations/listeners/reservation-metrics.listener.ts backend/src/reservations/test/reservation-metrics.listener.spec.ts backend/src/reservations/reservations.module.ts
git commit -m "feat(observability): add reservation funnel metrics listener"
```

---

## Task 4: Payment funnel metrics

**Files:**
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/payments/test/payments.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `payments.service.spec.ts`'s mock setup near the other `mock*` consts:

```typescript
const mockMetrics = {
  paymentsSucceeded: { inc: jest.fn() },
  paymentsFailed: { inc: jest.fn() },
  paymentsDeclined: { inc: jest.fn() },
  paymentsTimedOut: { inc: jest.fn() },
  paymentsRefunded: { inc: jest.fn() },
};
```

Add `{ provide: getToken('payments_succeeded_total'), useValue: mockMetrics.paymentsSucceeded }`
(and the equivalent for `failed`/`declined`/`timed_out`/`refunded`) to the `providers` array in
`beforeEach`, and `import { getToken } from '@willsoto/nestjs-prometheus';` at the top. Also add
`jest.clearAllMocks()` coverage for these mocks isn't needed beyond the existing `jest.clearAllMocks()`
call already in `beforeEach` (it clears every `jest.fn()` regardless of which object holds it).

Then add these assertions to the existing relevant `describe` blocks:

```typescript
  // inside describe('handleWebhookEvent', ...), extending the existing
  // "checkout.session.completed (paid) -> SUCCEEDED" test:
  it('increments payments_succeeded_total on a paid checkout.session.completed', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_metric_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          payment_intent: 'pi_1',
          metadata: { paymentId: '1' },
        },
      },
    });
    mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
    mockPaymentsRepo.findById.mockResolvedValue({ id: 1, reservationId: 100 });
    mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });

    await service.handleWebhookEvent(Buffer.from('{}'), 'sig_test');

    expect(mockMetrics.paymentsSucceeded.inc).toHaveBeenCalledTimes(1);
  });

  it('increments payments_failed_total on checkout.session.async_payment_failed', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_metric_2',
      type: 'checkout.session.async_payment_failed',
      data: { object: { metadata: { paymentId: '1' } } },
    });
    mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
    mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });
    mockReservationsService.getById.mockResolvedValue({ id: 100, userId: 7 });

    await service.handleWebhookEvent(Buffer.from('{}'), 'sig_test');

    expect(mockMetrics.paymentsFailed.inc).toHaveBeenCalledTimes(1);
  });

  it('increments payments_timed_out_total on checkout.session.expired', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_metric_3',
      type: 'checkout.session.expired',
      data: { object: { metadata: { paymentId: '1' } } },
    });
    mockPaymentsRepo.findByStripeEventId.mockResolvedValue(null);
    mockPaymentsRepo.update.mockResolvedValue({ id: 1, reservationId: 100 });

    await service.handleWebhookEvent(Buffer.from('{}'), 'sig_test');

    expect(mockMetrics.paymentsTimedOut.inc).toHaveBeenCalledTimes(1);
  });

  // inside describe('refundReservation', ...):
  it('increments payments_refunded_total on a real refund, not on the idempotent short-circuit', async () => {
    const confirmed = { id: 100, screeningId: 3, seatId: 11, status: 'CONFIRMED', userId: 7 };
    mockPaymentsRepo.findByReservationId.mockResolvedValue({
      id: 1,
      reservationId: 100,
      amount: 5000,
      stripePaymentId: 'pi_1',
      status: PaymentStatus.SUCCEEDED,
    });
    mockScreeningsRepo.findById.mockResolvedValue({
      ...screening,
      startTime: new Date(Date.now() + 72 * 60 * 60_000),
    });
    mockPaymentsRepo.findRefundPolicy.mockResolvedValue({ refundPercent: 100 });
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1' });
    mockReservationsService.finalizeCancel.mockResolvedValue({ ...confirmed, status: 'CANCELLED' });

    await service.refundReservation(confirmed as never);

    expect(mockMetrics.paymentsRefunded.inc).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockPaymentsRepo.findByReservationId.mockResolvedValue({
      id: 1,
      reservationId: 100,
      status: PaymentStatus.REFUNDED,
    });
    mockReservationsService.finalizeCancel.mockResolvedValue({ ...confirmed, status: 'CANCELLED' });

    await service.refundReservation(confirmed as never);

    expect(mockMetrics.paymentsRefunded.inc).not.toHaveBeenCalled();
  });

  // inside describe('reconcileTimedOutPayments', ...):
  it('increments payments_succeeded_total on a reconciled paid payment', async () => {
    mockPaymentsRepo.findStuckTimedOut.mockResolvedValue([
      { id: 1, reservationId: 100, stripeSessionId: 'cs_1' },
    ]);
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: 'paid',
      payment_intent: 'pi_9',
    });
    mockPaymentsRepo.confirmWithReservation.mockResolvedValue({
      payment: { id: 1, reservationId: 100 },
      reservation: { id: 100, screeningId: 3, seatId: 11 },
    });

    await service.reconcileTimedOutPayments();

    expect(mockMetrics.paymentsSucceeded.inc).toHaveBeenCalledTimes(1);
  });

  it('increments payments_declined_total on a reconciled declined payment', async () => {
    mockPaymentsRepo.findStuckTimedOut.mockResolvedValue([
      { id: 2, reservationId: 101, stripeSessionId: 'cs_2' },
    ]);
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ payment_status: 'unpaid' });
    mockPaymentsRepo.declineWithReservation.mockResolvedValue({
      payment: { id: 2, reservationId: 101 },
      reservation: { id: 101, screeningId: 3, seatId: 12, userId: 7 },
    });

    await service.reconcileTimedOutPayments();

    expect(mockMetrics.paymentsDeclined.inc).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: FAIL — `Nest can't resolve dependencies of PaymentsService` (the new metric providers aren't in
the constructor yet) or the new assertions fail against the un-wired service.

- [ ] **Step 3: Inject the counters and increment at each transition**

```typescript
// backend/src/payments/payments.service.ts
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
```

```typescript
  constructor(
    private readonly paymentsRepo: PaymentsRepository,
    @Inject(forwardRef(() => ReservationsService))
    private readonly reservationsService: ReservationsService,
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly paymentAbuse: PaymentAbuseService,
    private readonly events: EventEmitter2,
    @InjectMetric('payments_succeeded_total')
    private readonly paymentsSucceeded: Counter<string>,
    @InjectMetric('payments_failed_total')
    private readonly paymentsFailed: Counter<string>,
    @InjectMetric('payments_declined_total')
    private readonly paymentsDeclined: Counter<string>,
    @InjectMetric('payments_timed_out_total')
    private readonly paymentsTimedOut: Counter<string>,
    @InjectMetric('payments_refunded_total')
    private readonly paymentsRefunded: Counter<string>,
  ) {}
```

In `handleCheckoutCompleted`'s paid branch, right after the reservation is confirmed and the payment row
updated:

```typescript
      await this.reservationsService.confirmPayment(payment.reservationId);
      await this.paymentsRepo.update(paymentId, {
        status: PaymentStatus.SUCCEEDED,
        stripeEventId: event.id,
        stripePaymentId: session.payment_intent as string,
      });
      this.paymentsSucceeded.inc();
      return;
```

In `handleAsyncPaymentFailed`, after `recordFailure`:

```typescript
    const reservation = await this.reservationsService.getById(
      payment.reservationId,
    );
    await this.paymentAbuse.recordFailure(reservation.userId);
    this.paymentsFailed.inc();
```

In `handleCheckoutExpired`, after the update:

```typescript
    await this.paymentsRepo.update(paymentId, {
      status: PaymentStatus.TIMED_OUT,
      stripeEventId: event.id,
    });
    this.paymentsTimedOut.inc();
```

In `refundReservation`, only on the real-refund path (not the `REFUNDED` idempotent short-circuit at the
top of the method) — right after the `paymentsRepo.update(...REFUNDED...)` call inside the `try` block:

```typescript
    try {
      await this.paymentsRepo.update(payment.id, {
        status: PaymentStatus.REFUNDED,
        refundId,
        refundedAt: new Date(),
      });
      this.paymentsRefunded.inc();

      return await this.reservationsService.finalizeCancel(reservation);
```

In `reconcileTimedOutPayments`, in each branch:

```typescript
      if (session.payment_status === 'paid') {
        const { reservation } = await this.paymentsRepo.confirmWithReservation(
          payment.id,
          payment.reservationId,
          session.payment_intent as string,
        );
        this.paymentsSucceeded.inc();
        this.events.emit(RESERVATION_CONFIRMED, {
          screeningId: reservation.screeningId,
          seatIds: [reservation.seatId],
        });
      } else {
        const { reservation } = await this.paymentsRepo.declineWithReservation(
          payment.id,
          payment.reservationId,
        );
        this.paymentsDeclined.inc();
        this.events.emit(RESERVATION_CANCELLED, {
          screeningId: reservation.screeningId,
          seatIds: [reservation.seatId],
        });
        await this.paymentAbuse.recordFailure(reservation.userId);
      }
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd backend && npx jest payments.service.spec.ts`
Expected: PASS, all tests green (existing + the new metric assertions from Step 1).

- [ ] **Step 5: Commit**

```bash
git add backend/src/payments/payments.service.ts backend/src/payments/test/payments.service.spec.ts
git commit -m "feat(observability): add payment funnel metrics to PaymentsService"
```

---

## Task 5: Payment-abuse lockout metric

**Files:**
- Modify: `backend/src/redis/payment-abuse.service.ts`
- Modify: `backend/src/redis/test/payment-abuse.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `payment-abuse.service.spec.ts`:

```typescript
import { getToken } from '@willsoto/nestjs-prometheus';

const mockLockoutsCounter = { inc: jest.fn() };
```

Add `{ provide: getToken('payment_abuse_lockouts_total'), useValue: mockLockoutsCounter }` to the
`providers` array in `beforeEach`.

Add inside `describe('recordFailure', ...)`:

```typescript
    it('increments payment_abuse_lockouts_total only on the 3rd failure', async () => {
      mockClient.zcard.mockResolvedValue(2);
      await service.recordFailure(7);
      expect(mockLockoutsCounter.inc).not.toHaveBeenCalled();

      mockClient.zcard.mockResolvedValue(3);
      await service.recordFailure(7);
      expect(mockLockoutsCounter.inc).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd backend && npx jest payment-abuse.service.spec.ts`
Expected: FAIL — `Nest can't resolve dependencies of PaymentAbuseService`.

- [ ] **Step 3: Inject the counter and increment on lockout**

```typescript
// backend/src/redis/payment-abuse.service.ts
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
```

```typescript
  constructor(
    private readonly redis: RedisCache,
    @InjectMetric('payment_abuse_lockouts_total')
    private readonly lockoutsCounter: Counter<string>,
  ) {}
```

```typescript
    if (count >= FAILURE_THRESHOLD) {
      await client.set(`payment_lockout:user:${userId}`, '1', 'PX', LOCKOUT_MS);
      this.lockoutsCounter.inc();
    }
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd backend && npx jest payment-abuse.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/redis/payment-abuse.service.ts backend/src/redis/test/payment-abuse.service.spec.ts
git commit -m "feat(observability): add payment-abuse lockout metric"
```

---

## Task 6: WebSocket gateway metrics

**Files:**
- Modify: `backend/src/gateway/screening.gateway.ts`
- Modify: `backend/src/gateway/test/screening.gateway.spec.ts`
- Modify: `backend/src/gateway/reservation-broadcast.listener.ts`
- Modify: `backend/src/gateway/test/reservation-broadcast.listener.spec.ts`

- [ ] **Step 1: Write the failing gateway tests**

Add to `screening.gateway.spec.ts`:

```typescript
import { getToken } from '@willsoto/nestjs-prometheus';

const mockConnectionsGauge = { inc: jest.fn(), dec: jest.fn() };
const mockJoinsCounter = { inc: jest.fn() };
```

Add these two providers to the `providers` array in `beforeEach`:
```typescript
        {
          provide: getToken('websocket_connections_current'),
          useValue: mockConnectionsGauge,
        },
        {
          provide: getToken('websocket_room_joins_total'),
          useValue: mockJoinsCounter,
        },
```

Add inside `describe('handleConnection', ...)`:

```typescript
    it('increments the connections gauge', () => {
      const client = mockClient() as unknown as Socket;
      gateway.handleConnection(client);
      expect(mockConnectionsGauge.inc).toHaveBeenCalledTimes(1);
    });
```

Add a new `describe('handleDisconnect', ...)`:

```typescript
  describe('handleDisconnect', () => {
    it('decrements the connections gauge', () => {
      const client = mockClient() as unknown as Socket;
      gateway.handleDisconnect(client);
      expect(mockConnectionsGauge.dec).toHaveBeenCalledTimes(1);
    });
  });
```

Add inside `describe('handleJoin', ...)`, extending the success case:

```typescript
    it('increments the room-joins counter only on a successful join', async () => {
      mockScreeningsService.getSeatMap.mockResolvedValue([]);
      mockScreeningsService.getScreeningSummary.mockResolvedValue({
        screeningId: 10,
        capacity: 1,
        held: 0,
        booked: 0,
        available: 1,
        reserved: 0,
      });
      const client = mockClient();

      await gateway.handleJoin({ screeningId: 10 }, client as unknown as Socket);

      expect(mockJoinsCounter.inc).toHaveBeenCalledTimes(1);
    });

    it('does not increment the room-joins counter on an invalid screeningId', async () => {
      const client = mockClient();
      await gateway.handleJoin({ screeningId: NaN }, client as unknown as Socket);
      expect(mockJoinsCounter.inc).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd backend && npx jest screening.gateway.spec.ts`
Expected: FAIL — `Nest can't resolve dependencies of ScreeningGateway`, and `gateway.handleDisconnect is
not a function`.

- [ ] **Step 3: Implement in `ScreeningGateway`**

```typescript
// backend/src/gateway/screening.gateway.ts
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Gauge } from 'prom-client';
```

```typescript
@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL } })
export class ScreeningGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly screeningsService: ScreeningsService,
    @InjectMetric('websocket_connections_current')
    private readonly connectionsGauge: Gauge<string>,
    @InjectMetric('websocket_room_joins_total')
    private readonly joinsCounter: Counter<string>,
  ) {}

  handleConnection(client: Socket): void {
    // DEFERRED(phase-7): attach holder identity here (verify the httpOnly
    // access_token cookie via JwtService) once per-holder hold-expiry
    // notifications need to target a specific socket. Requires re-enabling
    // `credentials: true` in the gateway's CORS options above.
    void client;
    this.connectionsGauge.inc();
  }

  handleDisconnect(client: Socket): void {
    void client;
    this.connectionsGauge.dec();
  }

  @SubscribeMessage('join:screening')
  async handleJoin(
    @MessageBody() data: { screeningId: number },
    @ConnectedSocket() client: Socket,
  ): Promise<JoinScreeningResult> {
    const screeningId = Number(data?.screeningId);
    if (!Number.isInteger(screeningId) || screeningId < 1) {
      return { ok: false, error: 'Invalid screeningId' };
    }

    try {
      const seats = await this.screeningsService.getSeatMap(screeningId);
      const summary =
        await this.screeningsService.getScreeningSummary(screeningId);
      client.join(roomName(screeningId));
      this.joinsCounter.inc();
      return { ok: true, seats, summary };
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

  /* ...emitToRoom and the DEFERRED(phase-7) comment above it unchanged... */
}
```

- [ ] **Step 4: Run the gateway tests, confirm they pass**

Run: `cd backend && npx jest screening.gateway.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Write the failing broadcast-listener test**

Add to `reservation-broadcast.listener.spec.ts`:

```typescript
import { getToken } from '@willsoto/nestjs-prometheus';

const mockBroadcastsCounter = { inc: jest.fn() };
```

Add `{ provide: getToken('websocket_broadcasts_total'), useValue: mockBroadcastsCounter }` to the
`providers` array in `beforeEach`.

Add a new top-level test:

```typescript
  it('increments websocket_broadcasts_total labeled by event, once per broadcast call', async () => {
    await listener.handleCreated({ screeningId: 10, seatIds: [1] });
    expect(mockBroadcastsCounter.inc).toHaveBeenCalledWith({ event: 'seat:reserved' });

    await listener.handleCancelled({ screeningId: 10, seatIds: [1] });
    expect(mockBroadcastsCounter.inc).toHaveBeenCalledWith({ event: 'seat:cancelled' });

    await listener.handleConfirmed({ screeningId: 10, seatIds: [11] });
    expect(mockBroadcastsCounter.inc).toHaveBeenCalledWith({ event: 'seat:booked' });
  });
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd backend && npx jest reservation-broadcast.listener.spec.ts`
Expected: FAIL — `Nest can't resolve dependencies of ReservationBroadcastListener`.

- [ ] **Step 7: Implement in `ReservationBroadcastListener`**

```typescript
// backend/src/gateway/reservation-broadcast.listener.ts
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
```

```typescript
  constructor(
    private readonly gateway: ScreeningGateway,
    private readonly screeningsService: ScreeningsService,
    @InjectMetric('websocket_broadcasts_total')
    private readonly broadcastsCounter: Counter<string>,
  ) {}
```

```typescript
  private async broadcast(
    payload: ReservationChangedPayload,
    event: string,
    status: SeatStatus,
  ): Promise<void> {
    this.broadcastsCounter.inc({ event });

    try {
      this.gateway.emitToRoom(payload.screeningId, event, {
        /* ...unchanged... */
      });
    } catch (err) {
      /* ...unchanged... */
    }
    /* ...rest unchanged... */
  }
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd backend && npx jest reservation-broadcast.listener.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 9: Run the full unit suite + build**

Run: `cd backend && npx jest && npx nest build`
Expected: PASS / no errors.

- [ ] **Step 10: Commit**

```bash
git add backend/src/gateway/screening.gateway.ts backend/src/gateway/test/screening.gateway.spec.ts backend/src/gateway/reservation-broadcast.listener.ts backend/src/gateway/test/reservation-broadcast.listener.spec.ts
git commit -m "feat(observability): add WebSocket connection/join/broadcast metrics"
```

---

## Task 7: Prometheus + Grafana provisioning

**Files:**
- Create: `backend/docker-compose.monitoring.yml`
- Create: `backend/monitoring/prometheus.yml`
- Create: `backend/monitoring/grafana/datasources/prometheus.yml`
- Create: `backend/monitoring/grafana/dashboards/dashboard-provider.yml`
- Create: `backend/monitoring/grafana/dashboards/movie-reservation-system.json`

- [ ] **Step 1: Prometheus scrape config**

```yaml
# backend/monitoring/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'movie-reservation-backend'
    static_configs:
      # host.docker.internal: this repo's NestJS app runs on the host
      # (npm run start:dev), not inside this compose network.
      - targets: ['host.docker.internal:3000']
    metrics_path: /metrics
```

- [ ] **Step 2: Grafana datasource provisioning**

```yaml
# backend/monitoring/grafana/datasources/prometheus.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

- [ ] **Step 3: Grafana dashboard provisioning pointer**

```yaml
# backend/monitoring/grafana/dashboards/dashboard-provider.yml
apiVersion: 1

providers:
  - name: 'Movie Reservation System'
    folder: ''
    type: file
    options:
      path: /etc/grafana/provisioning/dashboards
```

- [ ] **Step 4: The dashboard itself**

```json
{
  "title": "Movie Reservation System",
  "uid": "movie-reservation-system",
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "panels": [
    {
      "type": "timeseries",
      "title": "HTTP request rate",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "targets": [
        {
          "expr": "sum(rate(http_requests_total[1m])) by (route)",
          "legendFormat": "{{route}}"
        }
      ]
    },
    {
      "type": "timeseries",
      "title": "HTTP p95 latency",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 0 },
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))",
          "legendFormat": "{{route}}"
        }
      ]
    },
    {
      "type": "timeseries",
      "title": "Reservations funnel (rate)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 },
      "targets": [
        { "expr": "rate(reservations_created_total[5m])", "legendFormat": "created" },
        { "expr": "rate(reservations_cancelled_total[5m])", "legendFormat": "cancelled" },
        { "expr": "rate(reservations_confirmed_total[5m])", "legendFormat": "confirmed" }
      ]
    },
    {
      "type": "stat",
      "title": "Reservations currently HELD",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 8 },
      "targets": [{ "expr": "reservations_held_current" }]
    },
    {
      "type": "timeseries",
      "title": "Payments funnel (rate)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 16 },
      "targets": [
        { "expr": "rate(payments_succeeded_total[5m])", "legendFormat": "succeeded" },
        { "expr": "rate(payments_failed_total[5m])", "legendFormat": "failed" },
        { "expr": "rate(payments_declined_total[5m])", "legendFormat": "declined" },
        { "expr": "rate(payments_timed_out_total[5m])", "legendFormat": "timed out" },
        { "expr": "rate(payments_refunded_total[5m])", "legendFormat": "refunded" }
      ]
    },
    {
      "type": "stat",
      "title": "Payment-abuse lockouts (total)",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 16 },
      "targets": [{ "expr": "payment_abuse_lockouts_total" }]
    },
    {
      "type": "timeseries",
      "title": "WebSocket activity",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 24 },
      "targets": [
        { "expr": "websocket_connections_current", "legendFormat": "connections" },
        { "expr": "rate(websocket_room_joins_total[5m])", "legendFormat": "joins/s" },
        {
          "expr": "sum(rate(websocket_broadcasts_total[5m])) by (event)",
          "legendFormat": "{{event}}"
        }
      ]
    },
    {
      "type": "timeseries",
      "title": "Node process health",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 24 },
      "targets": [
        { "expr": "process_resident_memory_bytes", "legendFormat": "RSS memory" },
        { "expr": "nodejs_eventloop_lag_seconds", "legendFormat": "event-loop lag" },
        { "expr": "rate(process_cpu_user_seconds_total[1m])", "legendFormat": "CPU" }
      ]
    }
  ]
}
```

Save this as `backend/monitoring/grafana/dashboards/movie-reservation-system.json`.

- [ ] **Step 5: The compose file**

```yaml
# backend/docker-compose.monitoring.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:v2.55.1
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - '9090:9090'
    extra_hosts:
      - 'host.docker.internal:host-gateway'

  grafana:
    image: grafana/grafana:11.3.1
    ports:
      - '3001:3000'
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: 'true'
      GF_AUTH_ANONYMOUS_ORG_ROLE: 'Admin'
    volumes:
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources:ro
      - ./monitoring/grafana/dashboards/dashboard-provider.yml:/etc/grafana/provisioning/dashboards/dashboard-provider.yml:ro
      - ./monitoring/grafana/dashboards/movie-reservation-system.json:/etc/grafana/provisioning/dashboards/movie-reservation-system.json:ro
    depends_on:
      - prometheus
```

`extra_hosts: host.docker.internal:host-gateway` makes `host.docker.internal` resolve on Linux Docker
hosts too (it works out of the box on Docker Desktop for Windows/Mac; this line is what makes the same
compose file portable to a Linux CI runner later, e.g. once GitLab CI is set up).
`GF_AUTH_ANONYMOUS_ENABLED` skips Grafana's login screen for local dev convenience — remove before any
non-local deployment.

- [ ] **Step 6: Bring it up and verify manually**

```bash
cd backend
npm run start:dev &   # or a separate terminal — the app must be running on :3000
docker compose -f docker-compose.monitoring.yml up -d
```

Then:
- Open `http://localhost:9090/targets` — expected: the `movie-reservation-backend` target shows `State: UP`.
- Open `http://localhost:3001` — expected: Grafana loads with no login prompt (anonymous admin), and the
  "Movie Reservation System" dashboard appears in the dashboard list with all 7 panels rendering (they'll
  show "No data" for panels backed by counters that haven't incremented yet — that's expected until some
  real traffic hits the app, e.g. `curl http://localhost:3000/api/v1/movies` a few times and refresh the
  HTTP panels).

Run: `docker compose -f docker-compose.monitoring.yml down` once verified.

- [ ] **Step 7: Commit**

```bash
git add backend/docker-compose.monitoring.yml backend/monitoring
git commit -m "feat(observability): add Prometheus + Grafana docker-compose provisioning"
```

---

## Task 8: Full verification pass

**Files:** none — verification only.

- [ ] **Step 1: Full unit suite + build**

Run: `cd backend && npx jest && npx nest build`
Expected: PASS / no errors — every spec touched across Tasks 2-6 runs together here for the first time.

- [ ] **Step 2: Manual end-to-end check of a real metric moving**

With the app running (`npm run start:dev`) and the monitoring stack up (Task 7 Step 6), reserve a seat
through the real API (any authenticated `POST /api/v1/reservations` call, e.g. via the frontend or a
manual `curl` with a valid cookie) and confirm in Grafana (or directly via
`curl http://localhost:3000/metrics | grep reservations_created_total`) that the counter incremented and
`reservations_held_current` is non-zero. This is the one check that proves the whole chain — event emission,
metric injection, Prometheus scrape, Grafana query — actually works together, not just each piece in
isolation.

- [ ] **Step 3: Report back**

Confirm the dashboard panels populate with real numbers as traffic flows, and note anything that looked
wrong (a panel with a broken PromQL expression, a metric that never incremented) — this is the equivalent
checkpoint to the payments plan's Task 15 manual smoke test, since Grafana rendering can't be verified by
`npx jest` alone.

---

## Self-Review Notes

- **Spec coverage:** `MetricsModule` + HTTP interceptor (Tasks 1-2), reservation funnel (Task 3), payment
  funnel (Task 4), payment-abuse lockout (Task 5), WebSocket gauges/counters (Task 6), and the full
  Prometheus/Grafana provisioning + dashboard (Task 7) all map to a task. The "unauthenticated but
  network-isolated" security decision is realized by Task 7's compose file never publishing the app's own
  port and the app not running inside that compose network at all — no separate guard code needed, matching
  the design's explicit call.
- **Type/name consistency:** every metric name (`reservations_created_total`,
  `payments_succeeded_total`, `websocket_connections_current`, etc.) is spelled identically between where
  it's registered (Task 1's `MetricsModule`) and every place it's injected via `@InjectMetric('...')`
  across Tasks 2-6 — a mismatch here would fail at Nest's DI resolution, so this was cross-checked token by
  token while writing the tasks.
- **Pre-existing dependency verified, not assumed:** `@willsoto/nestjs-prometheus` and `prom-client` were
  confirmed present in both `package.json` and `node_modules` via `npm ls` before this plan was written —
  no install step was fabricated on the assumption they'd need adding.
