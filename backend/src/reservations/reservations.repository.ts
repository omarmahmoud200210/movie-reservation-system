import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, Reservation, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface HoldSeatParams {
  userId: number;
  screeningId: number;
  hallId: number;
  seatId: number;
  heldUntil: Date;
}

export interface ExpiredHold {
  id: number;
  userId: number;
  screeningId: number;
  seatId: number;
}

@Injectable()
export class ReservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically hold one seat for a screening.
   *
   * Runs at the connection default isolation (READ COMMITTED), so once a racing
   * transaction commits, our post-lock existence check reads its fresh row and
   * bows out with a 409. Correctness rests on three layers:
   *   1. `FOR UPDATE` serializes concurrent reservers of the same seat.
   *   2. the existence check rejects a seat already HELD/CONFIRMED.
   *   3. the partial unique index (P2002) is the final backstop.
   */
  holdSeat(params: HoldSeatParams): Promise<Reservation> {
    const { userId, screeningId, hallId, seatId, heldUntil } = params;

    return this.prisma.$transaction(async (tx) => {
      try {
        const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT id FROM "seat"
          WHERE id = ${seatId} AND "hallId" = ${hallId}
          FOR UPDATE`);

        if (locked.length !== 1) {
          throw new BadRequestException(
            'Seat does not exist in this screening hall',
          );
        }

        const taken = await tx.reservation.findFirst({
          where: {
            screeningId,
            seatId,
            status: {
              in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
            },
          },
          select: { id: true },
        });

        if (taken) {
          throw new ConflictException(
            'This seat is already reserved for this screening',
          );
        }

        return await tx.reservation.create({
          data: {
            userId,
            screeningId,
            seatId,
            status: ReservationStatus.HELD,
            heldUntil,
          },
        });
      } catch (err) {
        if (
          err instanceof ConflictException ||
          err instanceof BadRequestException
        ) {
          throw err;
        }
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            'This seat is already reserved for this screening',
          );
        }
        if (
          err instanceof Prisma.PrismaClientUnknownRequestError &&
          (err.message?.includes('timed out') ||
            err.message?.includes('Connection acquisition'))
        ) {
          throw new ServiceUnavailableException(
            'System is under heavy load — please try again',
          );
        }
        throw new InternalServerErrorException(
          'Reservation failed due to a database error',
        );
      }
    });
  }

  /** Pushes heldUntil out — used when a checkout session outlives the normal hold window. */
  extendHold(id: number, until: Date): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: { heldUntil: until },
    });
  }

  /** HELD -> CONFIRMED on successful payment; heldUntil no longer applies. */
  confirm(id: number): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CONFIRMED, heldUntil: null },
    });
  }

  /**
   * Atomically release every HELD reservation whose hold has expired,
   * returning exactly the rows this call changed. A single UPDATE...RETURNING
   * has no find-then-update race window, unlike a separate SELECT + UPDATE.
   * Reuses the same Prisma.sql/$queryRaw escape hatch as `holdSeat`, for the
   * same reason: Prisma's query builder can't express this.
   */
  releaseExpiredHolds(now: Date): Promise<ExpiredHold[]> {
    return this.prisma.$queryRaw<ExpiredHold[]>(Prisma.sql`
      UPDATE "reservation"
      SET status = 'CANCELLED', "heldUntil" = NULL, "updatedAt" = ${now}
      WHERE status = 'HELD' AND "heldUntil" < ${now}
      RETURNING id, "userId", "screeningId", "seatId"
    `);
  }

  findById(id: number): Promise<Reservation | null> {
    return this.prisma.reservation.findUnique({ where: { id } });
  }

  setStatus(id: number, status: ReservationStatus): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: { status },
    });
  }

  findByUser(userId: number) {
    return this.prisma.reservation.findMany({
      where: { userId },
      include: {
        seat: true,
        screen: { include: { movie: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
