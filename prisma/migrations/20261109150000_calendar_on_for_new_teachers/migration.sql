-- New teachers can schedule classes from the start (admins kept forgetting to
-- switch the calendar on for cover teachers). Existing teachers keep their setting.
ALTER TABLE "TutorProfile" ALTER COLUMN "canEditCalendar" SET DEFAULT true;
