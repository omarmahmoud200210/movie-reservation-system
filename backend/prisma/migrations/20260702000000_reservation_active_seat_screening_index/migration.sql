-- Partial unique index: at most one ACTIVE (HELD/CONFIRMED) reservation per
-- (seat, screening). This is the last-line-of-defense backstop against
-- double-booking; a duplicate insert surfaces as Prisma P2002 -> HTTP 409.
--
-- A CANCELLED reservation falls outside the WHERE clause, so a cancelled seat
-- can be re-booked. Partial (WHERE) indexes aren't expressible in schema.prisma,
-- so this index is maintained via raw SQL only.
CREATE UNIQUE INDEX "reservation_active_seat_screening_key"
  ON "reservation" ("seatId", "screeningId")
  WHERE status IN ('HELD', 'CONFIRMED');
