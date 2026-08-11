-- 18,000 seats = 120 halls x 150 seats.
--
-- IMPORTANT: hall h owns seat ids (h-1)*150+1 .. h*150, because the serial
-- sequence assigns ids in this cross-join order (hall outer, seat inner).
-- The reservation generator relies on this formula, so if SEATS_PER_HALL
-- changes here it must change in 07-reservations.sql too.
INSERT INTO "seat" ("hallId", "row", number, "createdAt", "updatedAt")
SELECT
  h,
  'R' || ((s - 1) / 10),
  ((s - 1) % 10)::text,
  now() - (random() * 365) * interval '1 day',
  now() - (random() * 365) * interval '1 day'
FROM generate_series(1, 120) AS h
CROSS JOIN generate_series(1, 150) AS s;
