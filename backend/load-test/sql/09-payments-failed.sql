-- A small slice of CANCELLED reservations (~1%) also carry a failed payment
-- (TIMED_OUT / FAILED / DECLINED). This is what feeds the
-- findStuckTimedOut sweep, so the cleanup query has real data at scale.
-- reservationId stays unique because these reservations are disjoint from the
-- CONFIRMED ones handled in 08-payments-confirmed.sql.
INSERT INTO "payment" ("reservationId", amount, currency, status, "stripePaymentId", "stripeSessionId", "stripeEventId", "paymentDate", "createdAt", "updatedAt")
WITH p AS (
  SELECT
    r.id AS reservation_id,
    s.price AS amount,
    CASE
      WHEN random() < 0.3 THEN 'TIMED_OUT'
      WHEN random() < 0.5 THEN 'FAILED'
      ELSE 'DECLINED'
    END::"PaymentStatus" AS status,
    r."createdAt" AS created_at
  FROM "reservation" AS r
  JOIN "screening" AS s ON s.id = r."screeningId"
  WHERE r.status = 'CANCELLED' AND random() < 0.01
)
SELECT
  reservation_id,
  amount,
  'usd',
  status,
  NULL,
  'sess_' || reservation_id,
  'evt_' || reservation_id,
  created_at,
  created_at,
  created_at
FROM p;
