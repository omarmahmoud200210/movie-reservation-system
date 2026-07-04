import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, Reservation, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface HoldSeatsParams {
  userId: number;
  screeningId: number;
  hallId: number;
  seatIds: number[];
  heldUntil: Date;
}

export interface ExpiredHold {
  id: number;
  screeningId: number;
  seatId: number;
}

@Injectable()
export class ReservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically hold every requested seat for a screening, all-or-nothing.
   *
   * Runs at the connection default isolation (READ COMMITTED), so once a racing
   * transaction commits, our post-lock existence check reads its fresh row and
   * bows out with a 409. Correctness rests on three layers:
   *   1. `FOR UPDATE` serializes concurrent reservers of the same seats.
   *   2. the existence check rejects seats already HELD/CONFIRMED.
   *   3. the partial unique index (P2002) is the final backstop.
   *
   * Callers must pass a deduped `seatIds`.
   */
  holdSeats(params: HoldSeatsParams): Promise<Reservation[]> {
    const { userId, screeningId, hallId, seatIds, heldUntil } = params;

    return this.prisma.$transaction(async (tx) => {
      // Lock in a consistent order (ORDER BY id) so two requests locking
      // overlapping seat sets can't deadlock. The hallId filter doubles as
      // "these seats belong to this screening's hall".
      const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id FROM "seat"
        WHERE id IN (${Prisma.join(seatIds)}) AND "hallId" = ${hallId}
        ORDER BY id
        FOR UPDATE`);
      if (locked.length !== seatIds.length) {
        throw new BadRequestException(
          'One or more seats do not exist in this screening hall',
        );
      }

      const taken = await tx.reservation.findMany({
        where: {
          screeningId,
          seatId: { in: seatIds },
          status: {
            in: [ReservationStatus.HELD, ReservationStatus.CONFIRMED],
          },
        },
        select: { seatId: true },
      });
      if (taken.length > 0) {
        throw new ConflictException(
          'One or more seats are already reserved for this screening',
        );
      }

      try {
        return await tx.reservation.createManyAndReturn({
          data: seatIds.map((seatId) => ({
            userId,
            screeningId,
            seatId,
            status: ReservationStatus.HELD,
            heldUntil,
          })),
        });
      } catch (err) {
        // Unique-index backstop: a concurrent tx grabbed the same seat between
        // our check and insert.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            'One or more seats are already reserved for this screening',
          );
        }
        throw err;
      }
    });
  }

  /**
   * Atomically release every HELD reservation whose hold has expired,
   * returning exactly the rows this call changed. A single UPDATE...RETURNING
   * has no find-then-update race window, unlike a separate SELECT + UPDATE.
   * Reuses the same Prisma.sql/$queryRaw escape hatch as `holdSeats`, for the
   * same reason: Prisma's query builder can't express this.
   */
  releaseExpiredHolds(now: Date): Promise<ExpiredHold[]> {
    return this.prisma.$queryRaw<ExpiredHold[]>(Prisma.sql`
      UPDATE "reservation"
      SET status = 'CANCELLED', "heldUntil" = NULL
      WHERE status = 'HELD' AND "heldUntil" < ${now}
      RETURNING id, "screeningId", "seatId"
    `);
  }

  findById(id: number): Promise<Reservation | null> {
    return this.prisma.reservation.findUnique({ where: { id } });
  }

  setStatus(id: number, status: ReservationStatus): Promise<Reservation> {
    return this.prisma.reservation.update({ where: { id }, data: { status } });
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
