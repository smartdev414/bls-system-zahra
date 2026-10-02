-- Two new notifications:
--   HOMEWORK_REMINDER    — staff or a teacher nudging a student who is behind.
--   COURSE_TEACHER_ADDED — a tutor was put on a course as one of its teachers.
--
-- Without these values `Notification.createMany` rejects the insert, which
-- lib/notifications.ts catches and logs — the reminder would silently not send.
--
-- Kept in its own migration: Postgres will not let a value added to an enum be
-- used later in the same transaction, and Prisma runs each file separately.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HOMEWORK_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COURSE_TEACHER_ADDED';
