-- Assessment tests: a signed story in parts; students film their answers to
-- each part, then mark them against the answer sheet (or a teacher does).
ALTER TYPE "TestKind" ADD VALUE 'ASSESSMENT';
ALTER TABLE "Test" ADD COLUMN "answerMinutes" INTEGER;
ALTER TABLE "Test" ADD COLUMN "tutorMarks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuizQuestion" ADD COLUMN "questionsVideoUrl" TEXT;

-- Teachers hear when an assessment they mark has been sent in.
ALTER TYPE "NotificationType" ADD VALUE 'TEST_TO_MARK';
