-- Tests: whether students may control (pause, rewind, scrub) a question's
-- videos while sitting it, as the old platform's "Video Player Control Enable".
-- New questions start without controls; every existing question keeps the
-- controls it has always had.

ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "videoControls" BOOLEAN NOT NULL DEFAULT false;
UPDATE "QuizQuestion" SET "videoControls" = true;
