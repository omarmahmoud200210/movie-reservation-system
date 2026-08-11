-- Successful payments for every CONFIRMED reservation (85% SUCCEEDED, 15%
-- REFUNDED). Amounts come from the screening price; stripe ids are unique per
-- reservation. reservationId is unique because each reservation appears once.
INSERT INTO "payment" ("reservationId", amount, currency, status, "stripePaymentId", "stripeSessionId", "stripeEventId", "refundId", "refundedAt", "paymentDate", "createdAt", "updatedAt")
WITH p AS (
  SELECT
    r.id AS reservation_id,
    s.price AS amount,
    CASE WHEN random() < 0.85 THEN 'SUCCEEDED' ELSE 'REFUNDED' END::"PaymentStatus" AS status,
    r."createdAt" AS created_at
  FROM "reservation" AS r
  JOIN "screening" AS s ON s.id = r."screeningId"
  WHERE r.status = 'CONFIRMED'
)
SELECT
  reservation_id,
  amount,
  'usd',
  status,
  CASE WHEN status = 'SUCCEEDED' THEN 'pi_' || reservation_id ELSE NULL END,
  'sess_' || reservation_id,
  'evt_' || reservation_id,
  CASE WHEN status = 'REFUNDED' THEN 'ref_' || reservation_id ELSE NULL END,
  CASE WHEN status = 'REFUNDED' THEN created_at + interval '1 day' ELSE NULL END,
  created_at + interval '5 minutes',
  created_at,
  created_at
FROM p;
