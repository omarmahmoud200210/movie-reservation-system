import { Injectable } from '@nestjs/common';
import { Payment, Prisma, PaymentStatus, RefundPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByReservationId(reservationId: number): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { reservationId } });
  }

  findByStripeEventId(stripeEventId: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { stripeEventId } });
  }

  findByStripePaymentId(stripePaymentId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({ where: { stripePaymentId } });
  }

  create(data: Prisma.PaymentUncheckedCreateInput): Promise<Payment> {
    return this.prisma.payment.create({ data });
  }

  update(
    id: number,
    data: Prisma.PaymentUncheckedUpdateInput,
  ): Promise<Payment> {
    return this.prisma.payment.update({ where: { id }, data });
  }

  delete(id: number): Promise<Payment> {
    return this.prisma.payment.delete({ where: { id } });
  }

  findStuckTimedOut(olderThan: Date): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { status: PaymentStatus.TIMED_OUT, createdAt: { lt: olderThan } },
    });
  }

  findRefundPolicy(hoursUntilScreening: number): Promise<RefundPolicy | null> {
    return this.prisma.refundPolicy.findFirst({
      where: {
        hoursFrom: { lte: hoursUntilScreening },
        hoursTo: { gt: hoursUntilScreening },
      },
    });
  }
}
