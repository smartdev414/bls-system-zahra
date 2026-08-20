-- Slides picked ahead of class, so a prepared deck can be presented in one click.
ALTER TABLE "LiveSessionResource" ADD COLUMN "selectedPages" JSONB;
ALTER TABLE "LiveSessionResource" ADD COLUMN "totalPages" INTEGER;
