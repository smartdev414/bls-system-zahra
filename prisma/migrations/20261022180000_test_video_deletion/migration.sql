-- Students' test recordings: deleted a week after their course ends (it is
-- archived, or they leave it), with a reminder to download them first.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEST_VIDEOS_EXPIRING';

CREATE TABLE IF NOT EXISTS "TestVideoDeletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "deleteAt" TIMESTAMP(3) NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestVideoDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TestVideoDeletion_userId_courseId_key" ON "TestVideoDeletion"("userId", "courseId");
CREATE INDEX IF NOT EXISTS "TestVideoDeletion_deleteAt_idx" ON "TestVideoDeletion"("deleteAt");
