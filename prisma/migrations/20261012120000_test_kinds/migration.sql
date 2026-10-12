-- Kinds of test: story, fingerspelling and vocabulary, next to the plain
-- question test there has always been.
--
-- Lesson.testKind — what the test asks of the student. Existing tests are
--   STANDARD and are unchanged.
-- Lesson.storyUrl — STORY: the video the questions are about.
-- Lesson.answerSeconds — FINGERSPELLING / VOCABULARY: seconds for each sign.
-- QuizAttempt.durationMs — how long a go took; splits ties on the high scores.
-- QuizAttemptAnswer.answerText — the word typed or picked in those two tests,
--   where a question is a video and its word and has no options.
--
-- Additive and idempotent, like the other recent migrations, since this
-- database is also synced with `prisma db push`.

DO $$ BEGIN
  CREATE TYPE "TestKind" AS ENUM ('STANDARD', 'STORY', 'FINGERSPELLING', 'VOCABULARY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "testKind" "TestKind" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "storyUrl" TEXT;
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "answerSeconds" INTEGER;

ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;

ALTER TABLE "QuizAttemptAnswer" ADD COLUMN IF NOT EXISTS "answerText" TEXT;
