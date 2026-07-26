import { Injectable } from '@nestjs/common';
import { Payment, Prisma, PaymentStatus, RefundPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Reservation, ReservationStatus } from '@prisma/client';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByReservationId(reservationId: number): Promise<Payment | null> {
    return this.prisma.read.payment.findUnique({ where: { reservationId } });
  }

  findById(id: number): Promise<Payment | null> {
    return this.prisma.read.payment.findUnique({ where: { id } });
  }

  findByStripeEventId(stripeEventId: string): Promise<Payment | null> {
    return this.prisma.read.payment.findUnique({ where: { stripeEventId } });
  }

  findByStripePaymentId(stripePaymentId: string): Promise<Payment | null> {
    return this.prisma.read.payment.findFirst({ where: { stripePaymentId } });
  }

  create(data: Prisma.PaymentUncheckedCreateInput): Promise<Payment> {
    return this.prisma.write.payment.create({ data });
  }

  update(
    id: number,
    data: Prisma.PaymentUncheckedUpdateInput,
  ): Promise<Payment> {
    return this.prisma.write.payment.update({ where: { id }, data });
  }

  delete(id: number): Promise<Payment> {
    return this.prisma.write.payment.delete({ where: { id } });
  }

  findStuckTimedOut(olderThan: Date): Promise<Payment[]> {
    return this.prisma.read.payment.findMany({
      where: { status: PaymentStatus.TIMED_OUT, createdAt: { lt: olderThan } },
    });
  }

  findRefundPolicy(hoursUntilScreening: number): Promise<RefundPolicy | null> {
    return this.prisma.read.refundPolicy.findFirst({
      where: {
        hoursFrom: { lte: hoursUntilScreening },
        hoursTo: { gt: hoursUntilScreening },
      },
    });
  }

  async declineWithReservation(
    paymentId: number,
    reservationId: number,
  ): Promise<{ payment: Payment; reservation: Reservation }> {
    const [payment, reservation] = await this.prisma.write.$transaction([
      this.prisma.write.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.DECLINED },
      }),
      this.prisma.write.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CANCELLED },
      }),
    ]);
    return { payment, reservation };
  }

  async confirmWithReservation(
    paymentId: number,
    reservationId: number,
    stripePaymentId: string,
  ): Promise<{ payment: Payment; reservation: Reservation }> {
    const [payment, reservation] = await this.prisma.write.$transaction([
      this.prisma.write.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.SUCCEEDED,
          stripePaymentId,
        },
      }),
      this.prisma.write.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CONFIRMED, heldUntil: null },
      }),
    ]);
    return { payment, reservation };
  }
}
