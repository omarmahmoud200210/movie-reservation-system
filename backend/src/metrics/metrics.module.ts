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

const responseSizeHistograms = [
  makeHistogramProvider({
    name: 'http_response_size_bytes',
    help: 'HTTP response body size in bytes',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [100, 500, 1460, 5000, 10000, 50000, 100000, 500000],
  }),
];

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      global: true,
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [...counters, ...gauges, ...histograms, ...responseSizeHistograms],
  exports: [...counters, ...gauges, ...histograms, ...responseSizeHistograms],
})
export class MetricsModule {}
