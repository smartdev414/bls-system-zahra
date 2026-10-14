-- Courses are private or public. Private courses are seen only by the students
-- staff or a tutor put on them; public ones are in every student's catalogue.
--
-- Every existing course becomes PRIVATE (the column default): the school's
-- courses are real classes, so students stop seeing other levels' classes.
-- Students already enrolled keep them — enrolment is what grants access.

-- CreateEnum
CREATE TYPE "CourseVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "visibility" "CourseVisibility" NOT NULL DEFAULT 'PRIVATE';
