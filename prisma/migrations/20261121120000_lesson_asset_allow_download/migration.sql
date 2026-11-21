-- Students may download a lesson file only when its teacher allows it; off by default.
ALTER TABLE "LessonAsset" ADD COLUMN "allowDownload" BOOLEAN NOT NULL DEFAULT false;
