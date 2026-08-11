-- 120 halls, each with 150 seats. Hall ids land as 1..120 via the serial sequence.
INSERT INTO "hall" (name, capacity, "createdAt", "updatedAt")
SELECT
  'Hall ' || g,
  150,
  now() - (random() * 365) * interval '1 day',
  now() - (random() * 365) * interval '1 day'
FROM generate_series(1, 120) AS g;
