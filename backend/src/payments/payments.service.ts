import {
  ConflictException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentStatus, ReservationStatus } from '@prisma/client';
import { PaymentsRepository } from './payments.repository';
import { ReservationsService } from '../reservations/reservations.service';
import { ScreeningsRepository } from '../screenings/screenings.repository';
import PaymentAbuseService from '../redis/payment-abuse.service';

const CHECKOUT_EXPIRY_MINUTES = 30;
// ponytail: 'usd' while testing — flip to 'egp' once EGP is confirmed chargeable on the Stripe account.
const CURRENCY = 'usd';

@Injectable()
export class PaymentsService {
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
    const amount = screening!.price * 100;

    const payment = await this.paymentsRepo.create({
      reservationId,
      amount,
      currency: CURRENCY,
      status: PaymentStatus.PENDING,
      stripeSessionId: '',
    });

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
  }
}
