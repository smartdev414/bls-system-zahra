-- Folders of extra practice material for students (exam samples, videos, slides).
CREATE TYPE "StudentResourceFolder" AS ENUM ('EXAM_SAMPLES', 'VIDEO_LESSONS', 'SLIDES', 'PRACTICE', 'LINKS');

CREATE TABLE "StudentResource" (
    "id" TEXT NOT NULL,
    "folder" "StudentResourceFolder" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "isLink" BOOLEAN NOT NULL DEFAULT false,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "level" "CourseLevel",
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentResource_folder_createdAt_idx" ON "StudentResource"("folder", "createdAt");

ALTER TABLE "StudentResource" ADD CONSTRAINT "StudentResource_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
