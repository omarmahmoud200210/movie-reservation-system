import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import Stripe from 'stripe';
import { Payment, Prisma, PaymentStatus, Reservation, ReservationStatus } from '@prisma/client';
import { PaymentsRepository } from './payments.repository';
import { ReservationsService } from '../reservations/reservations.service';
import { ScreeningsRepository } from '../screenings/screenings.repository';
import PaymentAbuseService from '../redis/payment-abuse.service';

const CHECKOUT_EXPIRY_MINUTES = 30;
// ponytail: 'usd' while testing — flip to 'egp' once EGP is confirmed chargeable on the Stripe account.
const CURRENCY = 'usd';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

  constructor(
    private readonly paymentsRepo: PaymentsRepository,
    @Inject(forwardRef(() => ReservationsService))
    private readonly reservationsService: ReservationsService,
    private readonly screeningsRepo: ScreeningsRepository,
    private readonly paymentAbuse: PaymentAbuseService,
  ) {}

  async createCheckoutSession(
    userId: number,
    reservationId: number,
  ): Promise<{ url: string }> {
    const reservation = await this.reservationsService.findOwned(userId, reservationId);
    if (reservation.status !== ReservationStatus.HELD) {
      throw new ConflictException('Reservation is not held');
    }
    const existing = await this.paymentsRepo.findByReservationId(reservationId);
    if (existing) {
      throw new ConflictException('This reservation already has a payment');
    }

    const screening = await this.screeningsRepo.findById(reservation.screeningId);
    if (!screening) {
      throw new ConflictException('Screening no longer exists');
    }
    const amount = screening.price * 100;

    let payment: Payment;
    try {
      payment = await this.paymentsRepo.create({
        reservationId,
        amount,
        currency: CURRENCY,
        status: PaymentStatus.PENDING,
        stripeSessionId: '',
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('This reservation already has a payment');
      }
      throw err;
    }

    try {
      const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRY_MINUTES * 60;
      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: CURRENCY,
              product_data: { name: `Seat reservation #${reservationId}` },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.FRONTEND_URL}/reservations/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/reservations`,
        expires_at: expiresAt,
        metadata: { paymentId: String(payment.id) },
      });

      await this.paymentsRepo.update(payment.id, { stripeSessionId: session.id });
      await this.reservationsService.extendHold(reservationId, new Date(expiresAt * 1000));

      return { url: session.url as string };
    } catch (err) {
      await this.paymentsRepo.delete(payment.id);
      throw err;
    }
  }

  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<{ received: true }> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET as string,
      );
    } catch (err) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
    }

    const alreadyProcessed = await this.paymentsRepo.findByStripeEventId(event.id);
    if (alreadyProcessed) {
      return { received: true };
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event);
        break;
      case 'checkout.session.async_payment_failed':
        await this.handleAsyncPaymentFailed(event);
        break;
      case 'checkout.session.expired':
        await this.handleCheckoutExpired(event);
        break;
      case 'charge.dispute.created':
        await this.handleDisputeCreated(event);
        break;
      default:
        break;
    }

    return { received: true };
  }

  private paymentIdFrom(session: Stripe.Checkout.Session): number {
    return Number(session.metadata?.paymentId);
  }

  private async handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = this.paymentIdFrom(session);
    const payment = await this.paymentsRepo.findById(paymentId);
    if (!payment) return;

    if (session.payment_status === 'paid') {
      // Confirm the reservation FIRST, persist stripeEventId only after it
      // succeeds. If confirmPayment throws, this event is never marked
      // processed, so a Stripe retry re-enters and retries confirmPayment
      // (which is a plain idempotent status-set — safe to re-run).
      await this.reservationsService.confirmPayment(payment.reservationId);
      await this.paymentsRepo.update(paymentId, {
        status: PaymentStatus.SUCCEEDED,
        stripeEventId: event.id,
        stripePaymentId: session.payment_intent as string,
      });
      return;
    }

    await this.paymentsRepo.update(paymentId, {
      status: PaymentStatus.IN_PROGRESS,
      stripeEventId: event.id,
    });
  }

  private async handleAsyncPaymentFailed(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = this.paymentIdFrom(session);
    const payment = await this.paymentsRepo.update(paymentId, {
      status: PaymentStatus.FAILED,
      stripeEventId: event.id,
    });
    const reservation = await this.reservationsService.getById(payment.reservationId);
    await this.paymentAbuse.recordFailure(reservation.userId);
  }

  private async handleCheckoutExpired(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = this.paymentIdFrom(session);
    await this.paymentsRepo.update(paymentId, {
      status: PaymentStatus.TIMED_OUT,
      stripeEventId: event.id,
    });
  }

  private async handleDisputeCreated(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const payment = await this.paymentsRepo.findByStripePaymentId(dispute.payment_intent as string);
    if (!payment) {
      this.logger.warn(`Dispute event for unknown stripePaymentId=${dispute.payment_intent}`);
      return;
    }
    await this.paymentsRepo.update(payment.id, {
      disputed: true,
      disputeReason: dispute.reason,
      disputedAt: new Date(),
      stripeEventId: event.id,
    });
  }

  async refundReservation(reservation: Reservation): Promise<Reservation> {
    const payment = await this.paymentsRepo.findByReservationId(reservation.id);
    if (!payment) {
      throw new NotFoundException(`No payment found for reservation ${reservation.id}`);
    }

    const screening = await this.screeningsRepo.findById(reservation.screeningId);
    if (!screening) {
      throw new ConflictException('Screening no longer exists');
    }
    const hoursUntilScreening = (screening.startTime.getTime() - Date.now()) / (60 * 60 * 1000);
    const policy = await this.paymentsRepo.findRefundPolicy(hoursUntilScreening);
    const refundPercent = policy?.refundPercent ?? 0;
    const refundAmount = Math.round((payment.amount * refundPercent) / 100);

    let refundId: string | undefined;
    if (refundPercent > 0 && payment.stripePaymentId) {
      const refund = await this.stripe.refunds.create({
        payment_intent: payment.stripePaymentId,
        amount: refundAmount,
      });
      refundId = refund.id;
    }

    await this.paymentsRepo.update(payment.id, {
      status: PaymentStatus.REFUNDED,
      refundId,
      refundedAt: new Date(),
    });

    return this.reservationsService.finalizeCancel(reservation);
  }
}
