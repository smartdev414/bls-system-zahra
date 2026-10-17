-- CreateEnum
CREATE TYPE "CourseFormat" AS ENUM ('ONLINE', 'IN_PERSON');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "format" "CourseFormat" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN "venue" TEXT;

-- AlterTable
ALTER TABLE "LiveSession" ADD COLUMN "inPerson" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "venue" TEXT;
