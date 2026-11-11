-- AlterTable
ALTER TABLE "User" ADD COLUMN "hideFromLeagueTables" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SignRequest" ADD COLUMN "heldAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LiveSession" ADD COLUMN "week" INTEGER;

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN "subscriptionUrl" TEXT;
