-- Tutor resource library.
--
-- Tutors uploaded the same files lesson by lesson, on the day. The library lets
-- them upload a level's materials in advance and pick from it when building a
-- lesson or scheduling a live session.
--
-- New table only, written idempotently like the other recent migrations, since
-- this database is also synced with `prisma db push`.

CREATE TABLE IF NOT EXISTS "LibraryFile" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "assetType" "AssetType" NOT NULL,
    "presentationUrl" TEXT,
    "presentationMimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LibraryFile_tutorId_fileUrl_key"
  ON "LibraryFile"("tutorId", "fileUrl");

CREATE INDEX IF NOT EXISTS "LibraryFile_tutorId_createdAt_idx"
  ON "LibraryFile"("tutorId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "LibraryFile" ADD CONSTRAINT "LibraryFile_tutorId_fkey"
    FOREIGN KEY ("tutorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
