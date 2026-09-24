-- Prepared captions.
--
-- Tutors write captions in their library before class and send them into the
-- live classroom with one click. New table only, written idempotently like the
-- other recent migrations, since this database is also synced with `prisma db push`.

CREATE TABLE IF NOT EXISTS "PreparedCaption" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparedCaption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PreparedCaption_tutorId_order_idx"
  ON "PreparedCaption"("tutorId", "order");

DO $$ BEGIN
  ALTER TABLE "PreparedCaption" ADD CONSTRAINT "PreparedCaption_tutorId_fkey"
    FOREIGN KEY ("tutorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
