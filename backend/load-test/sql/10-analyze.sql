-- Refresh planner statistics after the bulk load so EXPLAIN decisions reflect
-- the real row counts (required before running db:bulk-seed:analyze).
ANALYZE;

-- findStuckTimedOut
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM "payment"
WHERE status = 'TIMED_OUT' 
AND "createdAt" < NOW();

-- releaseExpiredHolds
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, "userId", "screeningId", "seatId"
FROM "reservation"
WHERE status = 'HELD' AND "heldUntil" < NOW();

-- findByUser
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM "reservation"
WHERE "userId" = 1
ORDER BY "createdAt" DESC;

-- findActiveReservations
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT "seatId", status FROM "reservation"
WHERE "screeningId" = 1
AND status IN ('HELD', 'CONFIRMED');

-- findOverlapping
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM "screening"
WHERE "hallId" = 1 AND status <> 'CANCELLED';

-- hasReservations(movie)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT "reservation"."id" FROM "reservation"
JOIN "screening" ON "screening"."id" = "reservation"."screeningId"
WHERE "screening"."movieId" = 1
LIMIT 1;
