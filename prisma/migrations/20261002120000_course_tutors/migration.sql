-- Teachers assigned to a course.
--
-- Admins build each course (one per level) and put teachers on it. A teacher
-- can see the course, its lessons and its students and schedule classes for it,
-- but not change the content. New table only, written idempotently like the
-- other recent migrations, since this database is also synced with `prisma db push`.

CREATE TABLE IF NOT EXISTS "CourseTutor" (
    "courseId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseTutor_pkey" PRIMARY KEY ("courseId", "tutorId")
);

CREATE INDEX IF NOT EXISTS "CourseTutor_tutorId_idx"
  ON "CourseTutor"("tutorId");

DO $$ BEGIN
  ALTER TABLE "CourseTutor" ADD CONSTRAINT "CourseTutor_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourseTutor" ADD CONSTRAINT "CourseTutor_tutorId_fkey"
    FOREIGN KEY ("tutorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
