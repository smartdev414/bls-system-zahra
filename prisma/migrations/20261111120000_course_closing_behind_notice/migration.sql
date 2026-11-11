-- AlterTable
ALTER TABLE "Course" ADD COLUMN "closesAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "behindNoticeSeenAt" TIMESTAMP(3);
