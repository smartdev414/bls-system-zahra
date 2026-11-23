-- Extra files on a student resource (e.g. an exam video and its answers).
ALTER TABLE "StudentResource" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
