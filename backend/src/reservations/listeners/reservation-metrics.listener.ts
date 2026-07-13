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
