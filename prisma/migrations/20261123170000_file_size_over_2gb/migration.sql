-- File sizes were INT, which stops just under 2 GiB, so videos over 2 GB could
-- not be saved. Double precision holds whole byte counts exactly far beyond
-- any upload, and Prisma reads it back as a plain JS number (BigInt would not
-- serialise to JSON). Existing values convert losslessly.
ALTER TABLE "LessonAsset" ALTER COLUMN "fileSize" TYPE DOUBLE PRECISION;
ALTER TABLE "LibraryFile" ALTER COLUMN "fileSize" TYPE DOUBLE PRECISION;
ALTER TABLE "StudentResource" ALTER COLUMN "fileSize" TYPE DOUBLE PRECISION;
ALTER TABLE "LiveSessionResource" ALTER COLUMN "fileSize" TYPE DOUBLE PRECISION;
ALTER TABLE "ClassHandout" ALTER COLUMN "fileSize" TYPE DOUBLE PRECISION;
