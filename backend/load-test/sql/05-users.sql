-- 150,000 users. Emails and googleIds are unique by construction.
INSERT INTO "user" (name, email, password, "emailVerified", "googleId", role, "createdAt", "updatedAt")
SELECT
  'Bulk User ' || g,
  'bulkuser' || g || '@bulk.local',
  '$2b$10$BBP8THKuOYfRnxaJ9tjOO.R5208lxuzehqyCmnawfdWOE4TMk5lKO',
  true,
  CASE WHEN random() < 0.2 THEN 'google-' || g ELSE NULL END,
  CASE WHEN g = 1 THEN 'ADMIN' ELSE 'USER' END::"UserRole",
  now() - (random() * 365) * interval '1 day',
  now() - (random() * 365) * interval '1 day'
FROM generate_series(1, 150000) AS g;
