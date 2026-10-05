-- Tests: per-test settings, video on the question, and safe deletion.
--
-- Lesson.passMark / maxAttempts — the score a student needs to pass a test and
--   how many times they may sit it (null = unlimited). The pass mark was fixed
--   at 70 in code, so that is the default and existing tests are unchanged.
-- QuizQuestion.mediaType — the question itself can now carry a video (a sign to
--   identify), not only an image.
-- QuizAttemptAnswer.questionId — was ON DELETE RESTRICT, so a question or a
--   whole test could not be deleted once any student had sat it. Now cascades;
--   the attempt keeps the score it was given.
--
-- Additive and idempotent, like the other recent migrations, since this
-- database is also synced with `prisma db push`.

ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "passMark" INTEGER NOT NULL DEFAULT 70;
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER;

ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "mediaType" TEXT;

ALTER TABLE "QuizAttemptAnswer" DROP CONSTRAINT IF EXISTS "QuizAttemptAnswer_questionId_fkey";
ALTER TABLE "QuizAttemptAnswer"
  ADD CONSTRAINT "QuizAttemptAnswer_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
