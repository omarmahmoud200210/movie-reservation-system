-- ~67,000 screenings (__SCREENINGS__ is replaced by the runner). Start times
-- span ~365 days in the past to ~15 days in the future; status follows.
INSERT INTO "screening" ("hallId", "movieId", "startTime", status, price, "createdAt", "updatedAt")
WITH s AS (
  SELECT
    g,
    1 + (g % 120) AS hall_id,
    1 + (g % 1200) AS movie_id,
    now() + ((random() * 380) - 365) * interval '1 day' AS start_time
  FROM generate_series(1, __SCREENINGS__) AS g
)
SELECT
  hall_id,
  movie_id,
  start_time,
  CASE
    WHEN start_time > now() THEN 'SCHEDULED'
    WHEN random() < 0.05 THEN 'CANCELLED'
    ELSE 'COMPLETED'
  END::"ScreenStatus",
  (500 + floor(random() * 2501))::int,
  start_time - (random() * 30) * interval '1 day',
  start_time - (random() * 30) * interval '1 day'
FROM s;
