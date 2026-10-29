-- AlterTable
ALTER TABLE "User" ADD COLUMN "recordingOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recordingOptOutByStaff" BOOLEAN NOT NULL DEFAULT false;
