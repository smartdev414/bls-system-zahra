-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CLASS_HANDOUT_READY';

-- CreateTable
CREATE TABLE "ClassHandout" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "releaseAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassHandout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassHandout_sessionId_idx" ON "ClassHandout"("sessionId");

-- CreateIndex
CREATE INDEX "ClassHandout_releaseAt_idx" ON "ClassHandout"("releaseAt");

-- AddForeignKey
ALTER TABLE "ClassHandout" ADD CONSTRAINT "ClassHandout_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

