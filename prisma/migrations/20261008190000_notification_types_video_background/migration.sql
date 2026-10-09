-- Two new notifications, for whoever recorded a video whose background is
-- replaced after upload (lib/background-clean.ts):
--   VIDEO_BACKGROUND_READY  — the finished video is in place.
--   VIDEO_BACKGROUND_FAILED — it could not be done; the video needs a retry.
--
-- Without these values `Notification.create` rejects the insert, which
-- lib/notifications.ts catches and logs — the tutor would silently not be told.
--
-- Kept in its own migration: Postgres will not let a value added to an enum be
-- used later in the same transaction, and Prisma runs each file separately.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VIDEO_BACKGROUND_READY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VIDEO_BACKGROUND_FAILED';
