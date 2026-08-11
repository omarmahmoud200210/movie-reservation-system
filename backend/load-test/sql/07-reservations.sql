-- ~10M reservations: one row per (screening, seat) = every screening crossed
-- with its hall's 150 seats.
--
-- seatId is computed from the screening's hall using the seat-id formula from
-- 04-seats.sql: (hallId-1)*150 + seat_idx. This keeps FKs valid by construction.
--
-- One row per (screening, seat) also means at most one HELD/CONFIRMED row per
-- pair, which satisfies the partial unique index
-- reservation_active_seat_screening_key. Status mix:
--   ~10% HELD, ~30% CONFIRMED, ~60% CANCELLED.
INSERT INTO "reservation" ("screeningId", "seatId", "userId", status, "heldUntil", "createdAt", "updatedAt")
WITH r AS (
  SELECT
    s.id AS screening_id,
    (s."hallId" - 1) * 150 + seat_idx AS seat_id,
    (1 + floor(random() * 150000))::int AS user_id,
    CASE
      WHEN random() < 0.10 THEN 'HELD'
      WHEN random() < 0.40 THEN 'CONFIRMED'
      ELSE 'CANCELLED'
    END::"ReservationStatus" AS status,
    now() - (random() * 180) * interval '1 day' AS created_at
  FROM "screening" AS s
  CROSS JOIN generate_series(1, 150) AS seat_idx
)
SELECT
  screening_id,
  seat_id,
  user_id,
  status,
  CASE WHEN status = 'HELD' THEN now() + interval '15 minutes' ELSE NULL END,
  created_at,
  created_at
FROM r;
