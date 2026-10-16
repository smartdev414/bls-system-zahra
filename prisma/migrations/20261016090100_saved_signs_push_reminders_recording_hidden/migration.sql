-- Personal sign list, phone push notifications, automatic reminders, and
-- recordings hidden from students. Additive only: nothing existing changes.
-- Safe to run again (every statement checks first).

-- Recordings kept from students (staff can still watch) — see the next migration.
ALTER TABLE "LiveSession" ADD COLUMN IF NOT EXISTS "recordingHidden" BOOLEAN NOT NULL DEFAULT false;

-- One row per automatic reminder already sent, so none is ever sent twice.
CREATE TABLE IF NOT EXISTS "ReminderSent" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderSent_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "ReminderSent_createdAt_idx" ON "ReminderSent"("createdAt");

-- A device that turned on phone notifications (web push).
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- A dictionary sign a student starred.
CREATE TABLE IF NOT EXISTS "SavedSign" (
    "userId" TEXT NOT NULL,
    "signId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSign_pkey" PRIMARY KEY ("userId","signId")
);
CREATE INDEX IF NOT EXISTS "SavedSign_signId_idx" ON "SavedSign"("signId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscription_userId_fkey') THEN
    ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SavedSign_userId_fkey') THEN
    ALTER TABLE "SavedSign" ADD CONSTRAINT "SavedSign_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SavedSign_signId_fkey') THEN
    ALTER TABLE "SavedSign" ADD CONSTRAINT "SavedSign_signId_fkey"
      FOREIGN KEY ("signId") REFERENCES "Sign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
