-- Story tests: whether students may control (pause, rewind, skip) the story
-- video. New tests start without controls. Existing tests keep the controls
-- they have always had, except the Receptive Skills 201 tests copied from the
-- old platform, which had them off there (and the client asked for that).

ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "storyControls" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Test" SET "storyControls" = true WHERE id NOT LIKE 'old-l2-story-%';
