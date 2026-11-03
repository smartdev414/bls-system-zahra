
-- CreateEnum
CREATE TYPE "ReflectionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'COMPLETE');

-- AlterEnum
ALTER TYPE "TestKind" ADD VALUE 'REFLECTION';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REFLECTION_RETURNED';

-- AlterTable
ALTER TABLE "QuizQuestion" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "section" TEXT;

-- CreateTable
CREATE TABLE "ReflectionSubmission" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReflectionStatus" NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReflectionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReflectionFeedback" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "authorId" TEXT,
    "outcome" "ReflectionStatus" NOT NULL,
    "text" TEXT,
    "videoUrl" TEXT,
    "notes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReflectionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReflectionSubmission_lessonId_status_idx" ON "ReflectionSubmission"("lessonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReflectionSubmission_lessonId_userId_key" ON "ReflectionSubmission"("lessonId", "userId");

-- CreateIndex
CREATE INDEX "ReflectionFeedback_submissionId_idx" ON "ReflectionFeedback"("submissionId");

-- AddForeignKey
ALTER TABLE "ReflectionSubmission" ADD CONSTRAINT "ReflectionSubmission_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReflectionSubmission" ADD CONSTRAINT "ReflectionSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReflectionFeedback" ADD CONSTRAINT "ReflectionFeedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ReflectionSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReflectionFeedback" ADD CONSTRAINT "ReflectionFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

