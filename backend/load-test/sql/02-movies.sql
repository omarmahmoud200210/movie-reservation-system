-- 1,200 movies. Ids 1..1200 via the serial sequence.
INSERT INTO "movie" (name, description, duration, "posterImgUrl", "movieType", rating, language, genre, status, "createdAt", "updatedAt")
SELECT
  'Test Movie ' || g,
  'Description for test movie ' || g || '.',
  90 + (g % 90),
  'poster' || g || '.jpg',
  (ARRAY['2D', '3D', 'IMAX'])[1 + (g % 3)],
  round((4 + random() * 5) * 10) / 10,
  (ARRAY['en', 'es', 'ar', 'fr', 'hi', 'zh', 'pt', 'de'])[1 + (g % 8)],
  (ARRAY['Action', 'Comedy', 'Drama', 'Sci-Fi', 'Horror', 'Romance', 'Thriller', 'Animation'])[1 + (g % 8)],
  CASE WHEN g <= 50 THEN 'DRAFT' ELSE 'PUBLISHED' END::"MovieStatus",
  now() - (random() * 365) * interval '1 day',
  now() - (random() * 365) * interval '1 day'
FROM generate_series(1, 1200) AS g;
