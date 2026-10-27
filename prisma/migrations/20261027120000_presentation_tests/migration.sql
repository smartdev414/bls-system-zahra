-- AlterEnum
ALTER TYPE "TestKind" ADD VALUE 'PRESENTATION';

-- AlterTable
ALTER TABLE "QuizAttemptAnswer" ADD COLUMN "feedbackVideoUrl" TEXT;
