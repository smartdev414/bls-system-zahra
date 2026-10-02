-- Groups on a course, and the group a class is for.
--
-- CourseGroup          — which student groups take a course. Each group is one
--                        class with its own students and its own day and time.
-- LiveSession.groupId  — the group a class is scheduled for, so the course page
--                        can show each group's timetable next to its students.
--
-- Additive and idempotent, like the other recent migrations, since this
-- database is also synced with `prisma db push`.

CREATE TABLE IF NOT EXISTS "CourseGroup" (
    "courseId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseGroup_pkey" PRIMARY KEY ("courseId", "groupId")
);

CREATE INDEX IF NOT EXISTS "CourseGroup_groupId_idx" ON "CourseGroup"("groupId");

DO $$ BEGIN
  ALTER TABLE "CourseGroup" ADD CONSTRAINT "CourseGroup_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourseGroup" ADD CONSTRAINT "CourseGroup_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "LiveSession" ADD COLUMN IF NOT EXISTS "groupId" TEXT;

CREATE INDEX IF NOT EXISTS "LiveSession_groupId_idx" ON "LiveSession"("groupId");

DO $$ BEGIN
  ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
