-- Notifications for sign-up approval (lib/account-approval.ts):
--   ACCOUNT_PENDING_APPROVAL — to admins and support staff: someone is waiting.
--   ACCOUNT_APPROVED / ACCOUNT_REJECTED — to the student, with the outcome.
--
-- Kept in its own migration: Postgres will not let a value added to an enum be
-- used later in the same transaction, and Prisma runs each file separately.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_PENDING_APPROVAL';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_REJECTED';
