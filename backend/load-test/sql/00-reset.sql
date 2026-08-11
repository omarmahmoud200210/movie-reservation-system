-- Bulk loader: destroy all existing data and reset every id sequence.
-- Runs only when the runner is invoked with --clean.
TRUNCATE "refund_policy", "movie", "hall", "seat", "user", "screening", "reservation", "payment" RESTART IDENTITY CASCADE;
