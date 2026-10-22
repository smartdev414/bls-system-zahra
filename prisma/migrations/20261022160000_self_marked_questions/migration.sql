-- Tests: written answers and signed answers, both marked by the student
-- against the model answer once they have submitted, and changeable by a
-- teacher. Every existing question and attempt keeps working as it does now.

ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'WRITTEN';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'SIGN';

ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "modelAnswer" TEXT;
ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "answerVideoUrl" TEXT;

ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS "selfMarked" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "QuizAttemptAnswer" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;
ALTER TABLE "QuizAttemptAnswer" ADD COLUMN IF NOT EXISTS "marks" INTEGER;
ALTER TABLE "QuizAttemptAnswer" ADD COLUMN IF NOT EXISTS "markedByTutor" BOOLEAN NOT NULL DEFAULT false;
