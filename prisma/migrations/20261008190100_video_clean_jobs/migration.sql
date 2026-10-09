-- One row per recording sent to have its background replaced after upload
-- (lib/background-clean.ts): who recorded it, the colour asked for, and how
-- the job is getting on.

CREATE TYPE "VideoCleanStatus" AS ENUM ('PROCESSING', 'DONE', 'FAILED');

CREATE TABLE "VideoCleanJob" (
    "id" TEXT NOT NULL,
    "rawKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "runpodJobId" TEXT,
    "status" "VideoCleanStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoCleanJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoCleanJob_rawKey_key" ON "VideoCleanJob"("rawKey");
CREATE INDEX "VideoCleanJob_userId_idx" ON "VideoCleanJob"("userId");
CREATE INDEX "VideoCleanJob_status_idx" ON "VideoCleanJob"("status");

ALTER TABLE "VideoCleanJob" ADD CONSTRAINT "VideoCleanJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
