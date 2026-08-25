-- The notification a co-teaching invite is delivered as.
--
-- Without this value, `Notification.createMany` rejects the whole insert with
-- `invalid input value for enum "NotificationType"`. lib/notifications.ts
-- catches that and logs it, so the invited teacher gets no bell notification
-- and no email, while the teacher who sent it is told it worked. Student
-- invites are unaffected — SESSION_INVITE has been in the enum since the start,
-- which is why only teacher-to-teacher invites appear broken.
--
-- Kept in its own migration: Postgres will not let a value added to an enum be
-- used later in the same transaction, and Prisma runs each file separately.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_COTUTOR_INVITE';
