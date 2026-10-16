-- UK GDPR: recordings made before recordings became tutor-only (app/egress/
-- recorder-view.tsx) show students' faces and names. Hide them from students;
-- tutors and admins can still watch them. Recordings made after this keep the
-- default (visible to the class's students), since they contain no students.

UPDATE "LiveSession"
SET "recordingHidden" = true
WHERE "recordingUrl" IS NOT NULL OR "recordingKey" IS NOT NULL;
