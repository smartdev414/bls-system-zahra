-- The test bank: tests come out of the lessons into a Tests menu of their own,
-- so a test is made once and put in as many courses (levels) as needed.
--
-- Test — the test itself: title, kind, how it is passed, who made it. Its
--   questions hang off it (QuizQuestion.testId, was lessonId).
-- Lesson.testId — a lesson of type QUIZ now puts a bank test in a course.
--   Attempts stay on the lesson, so results are still kept per course.
--
-- Every test that already exists becomes a bank test with the same id as its
-- lesson, made by the course's tutor, with its questions moved across. Then
-- the test columns leave Lesson and lessonId leaves QuizQuestion.
--
-- Idempotent, like the other recent migrations, since this database is also
-- synced with `prisma db push`.

CREATE TABLE IF NOT EXISTS "Test" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "level" "CourseLevel",
  "testKind" "TestKind" NOT NULL DEFAULT 'STANDARD',
  "storyUrl" TEXT,
  "answerSeconds" INTEGER,
  "passMark" INTEGER NOT NULL DEFAULT 70,
  "maxAttempts" INTEGER,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Test_createdById_idx" ON "Test"("createdById");
CREATE INDEX IF NOT EXISTS "Test_level_idx" ON "Test"("level");
DO $$ BEGIN
  ALTER TABLE "Test" ADD CONSTRAINT "Test_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "testId" TEXT;
CREATE INDEX IF NOT EXISTS "Lesson_testId_idx" ON "Lesson"("testId");
DO $$ BEGIN
  ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_testId_fkey"
    FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "testId" TEXT;

-- Move the existing tests into the bank — only while the old columns are there.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'Lesson' AND column_name = 'passMark'
  ) THEN
    INSERT INTO "Test" ("id", "title", "description", "testKind", "storyUrl", "answerSeconds",
                        "passMark", "maxAttempts", "createdById", "createdAt", "updatedAt")
    SELECT l."id", l."title", l."description", l."testKind", l."storyUrl", l."answerSeconds",
           l."passMark", l."maxAttempts", c."tutorId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "Lesson" l
    JOIN "Section" s ON s."id" = l."sectionId"
    JOIN "Course" c ON c."id" = s."courseId"
    WHERE l."type" = 'QUIZ' AND l."testId" IS NULL
    ON CONFLICT ("id") DO NOTHING;

    UPDATE "Lesson" SET "testId" = "id" WHERE "type" = 'QUIZ' AND "testId" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'QuizQuestion' AND column_name = 'lessonId'
  ) THEN
    UPDATE "QuizQuestion" q SET "testId" = l."testId"
    FROM "Lesson" l
    WHERE l."id" = q."lessonId" AND q."testId" IS NULL;
    -- A question on a lesson that is not a test has nowhere to go.
    DELETE FROM "QuizQuestion" WHERE "testId" IS NULL;
  END IF;
END $$;

ALTER TABLE "QuizQuestion" ALTER COLUMN "testId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "QuizQuestion_testId_idx" ON "QuizQuestion"("testId");
DO $$ BEGIN
  ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_testId_fkey"
    FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "QuizQuestion" DROP CONSTRAINT IF EXISTS "QuizQuestion_lessonId_fkey";
DROP INDEX IF EXISTS "QuizQuestion_lessonId_idx";
ALTER TABLE "QuizQuestion" DROP COLUMN IF EXISTS "lessonId";

ALTER TABLE "Lesson" DROP COLUMN IF EXISTS "passMark";
ALTER TABLE "Lesson" DROP COLUMN IF EXISTS "maxAttempts";
ALTER TABLE "Lesson" DROP COLUMN IF EXISTS "testKind";
ALTER TABLE "Lesson" DROP COLUMN IF EXISTS "storyUrl";
ALTER TABLE "Lesson" DROP COLUMN IF EXISTS "answerSeconds";
