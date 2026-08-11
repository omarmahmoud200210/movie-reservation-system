-- The three fixed refund tiers (see the policy comment in schema.prisma):
--   >48h  -> 100%
--   24-48h -> 50%
--   <24h  -> 0%
INSERT INTO "refund_policy" ("hoursFrom", "hoursTo", "refundPercent", "createdAt", "updatedAt")
VALUES
  (48, 2147483647, 1.0, now(), now()),
  (24, 48, 0.5, now(), now()),
  (0, 24, 0.0, now(), now())
ON CONFLICT ("hoursFrom", "hoursTo") DO NOTHING;
