-- CreateEnum
CREATE TYPE "LoginMethod" AS ENUM ('PASSWORD', 'GOOGLE', 'REGISTER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "method" "LoginMethod" NOT NULL,
    "failureReason" TEXT,
    "client" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_success_createdAt_idx" ON "LoginEvent"("success", "createdAt");

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: until now "last seen" came from the API log, so start from there.
UPDATE "User" u SET "lastActiveAt" = l.last
FROM (SELECT "userId", MAX("createdAt") AS last FROM "ApiLog" WHERE "userId" IS NOT NULL GROUP BY "userId") l
WHERE u."id" = l."userId";

-- CreateIndex (student activity reads these per student)
CREATE INDEX "LeagueAttempt_userId_createdAt_idx" ON "LeagueAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReflectionSubmission_userId_updatedAt_idx" ON "ReflectionSubmission"("userId", "updatedAt");
