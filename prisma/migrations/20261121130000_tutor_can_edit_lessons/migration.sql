-- A per-teacher switch letting them add and change lessons on the courses they teach; off by default.
ALTER TABLE "TutorProfile" ADD COLUMN "canEditLessons" BOOLEAN NOT NULL DEFAULT false;
