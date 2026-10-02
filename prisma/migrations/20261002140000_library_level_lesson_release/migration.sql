-- Shared library levels and scheduled lesson release.
--
-- LibraryFile.level — which level a library file is for, so the school can file
--   a whole term's material in advance and teachers can find it by level.
-- Lesson.releaseAt  — when set, students do not see the lesson or test until
--   then, so content can be prepared ahead and released week by week.
--
-- Additive and idempotent, like the other recent migrations, since this
-- database is also synced with `prisma db push`.

ALTER TABLE "LibraryFile" ADD COLUMN IF NOT EXISTS "level" "CourseLevel";

ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "releaseAt" TIMESTAMP(3);
