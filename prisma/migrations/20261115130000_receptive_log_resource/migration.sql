-- AlterEnum
ALTER TYPE "ReceptiveActivity" ADD VALUE 'PRACTICE';

-- AlterTable
ALTER TABLE "ReceptiveLog" ADD COLUMN "resource" TEXT;
