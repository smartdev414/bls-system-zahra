-- CreateEnum
CREATE TYPE "SignRequestStatus" AS ENUM ('OPEN', 'ADDED', 'DECLINED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DICTIONARY_SIGN_ADDED';

-- CreateTable
CREATE TABLE "SignRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "status" "SignRequestStatus" NOT NULL DEFAULT 'OPEN',
    "signId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignRequest_status_idx" ON "SignRequest"("status");

-- CreateIndex
CREATE INDEX "SignRequest_studentId_idx" ON "SignRequest"("studentId");

-- CreateIndex
CREATE INDEX "SignRequest_signId_idx" ON "SignRequest"("signId");

-- AddForeignKey
ALTER TABLE "SignRequest" ADD CONSTRAINT "SignRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignRequest" ADD CONSTRAINT "SignRequest_signId_fkey" FOREIGN KEY ("signId") REFERENCES "Sign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

