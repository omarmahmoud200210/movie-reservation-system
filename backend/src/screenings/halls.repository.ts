import { Injectable } from '@nestjs/common';
import { Hall, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type HallWithSeats = Prisma.HallGetPayload<{ include: { seats: true } }>;

@Injectable()
export class HallsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Convert a zero-based row index to a spreadsheet-style letter label:
   * 0 → A, 25 → Z, 26 → AA, 27 → AB, …
   */
  private rowLabel(index: number): string {
    let n = index;
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  /**
   * Create a hall and its full seat grid atomically.
   * `capacity` is derived as `rows * seatsPerRow`; seats are positioned
   * `row` = letter (A, B, …) × `number` = '1'..'N'. Any failure rolls back
   * the whole transaction, so a hall never persists without its seats.
   */
  createHallWithSeats(input: {
    name: string;
    rows: number;
    seatsPerRow: number;
  }): Promise<HallWithSeats> {
    const { name, rows, seatsPerRow } = input;
    const capacity = rows * seatsPerRow;

    return this.prisma.write.$transaction(async (tx) => {
      const hall = await tx.hall.create({ data: { name, capacity } });

      const seats: Prisma.SeatCreateManyInput[] = [];
      for (let r = 0; r < rows; r++) {
        const row = this.rowLabel(r);
        for (let s = 1; s <= seatsPerRow; s++) {
          seats.push({ hallId: hall.id, row, number: String(s) });
        }
      }
      await tx.seat.createMany({ data: seats });

      return tx.hall.findUniqueOrThrow({
        where: { id: hall.id },
        include: { seats: { orderBy: [{ row: 'asc' }, { id: 'asc' }] } },
      });
    });
  }

  findHallWithSeats(id: number): Promise<HallWithSeats | null> {
    return this.prisma.read.hall.findUnique({
      where: { id },
      include: { seats: { orderBy: [{ row: 'asc' }, { id: 'asc' }] } },
    });
  }

  listHalls(): Promise<Hall[]> {
    return this.prisma.read.hall.findMany({ orderBy: { id: 'asc' } });
  }

  /** Lightweight existence/lookup without the seat grid. */
  findById(id: number): Promise<Hall | null> {
    return this.prisma.read.hall.findUnique({ where: { id } });
  }

  deleteHall(id: number): Promise<Hall> {
    return this.prisma.write.hall.delete({ where: { id } });
  }

  /** True if any reservation exists on any screening of this hall. */
  async hasReservations(hallId: number): Promise<boolean> {
    const reservation = await this.prisma.read.reservation.findFirst({
      where: { screen: { hallId } },
      select: { id: true },
    });
    return reservation !== null;
  }
}
