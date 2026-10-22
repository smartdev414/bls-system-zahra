-- Tests: show a question (and its answers) only once its video has played to
-- the end. Off for every existing question, which keeps how they work now.

ALTER TABLE "QuizQuestion" ADD COLUMN IF NOT EXISTS "questionAfterVideo" BOOLEAN NOT NULL DEFAULT false;
