-- Fingerspelling / vocabulary tests: how many times each sign's video plays.
-- 1 or 2 makes a harder test; NULL (every existing test) keeps the video
-- repeating until the time is up, as before.

ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "signPlays" INTEGER;
