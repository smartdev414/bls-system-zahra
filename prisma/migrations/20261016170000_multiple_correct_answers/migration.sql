-- Multiple choice questions can have more than one correct answer. The student
-- ticks them all, and every option ticked is kept here. Existing answers keep
-- their single optionId, so this is empty for them.

ALTER TABLE "QuizAttemptAnswer" ADD COLUMN IF NOT EXISTS "optionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
