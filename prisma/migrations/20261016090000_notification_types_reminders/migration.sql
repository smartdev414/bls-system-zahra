-- Automatic reminders (lib/reminders.ts):
--   SESSION_REMINDER — a class the student is in is tomorrow / starts within the hour.
--   LESSONS_UNLOCKED — lessons held back for a release date have just opened.
--
-- Kept in its own migration: Postgres will not let a value added to an enum be
-- used later in the same transaction, and Prisma runs each file separately.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LESSONS_UNLOCKED';
