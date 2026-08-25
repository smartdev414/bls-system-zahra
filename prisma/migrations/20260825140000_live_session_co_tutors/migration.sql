-- Co-teachers on a live session.
--
-- The model and the whole feature around it (invite UI, /co-tutors route, the
-- token grant, "sessions I was invited to") landed in June 2026, but migrations
-- only started being tracked here in August, so this table never had one. Any
-- database built from this folder has the feature's code and none of its
-- storage: the invite write fails, and the notification that would have told
-- the other teacher fails with it — silently, because notification failures are
-- swallowed. That is the "I invited another teacher and nothing happened" report.
--
-- Written idempotently on purpose. The long-running database very likely
-- already has these objects from an earlier `prisma db push`, and a plain
-- CREATE there would abort the whole deploy.

CREATE TABLE IF NOT EXISTS "LiveSessionCoTutor" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSessionCoTutor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LiveSessionCoTutor_tutorId_idx"
    ON "LiveSessionCoTutor"("tutorId");

-- One row per teacher per session: what makes `skipDuplicates` on the invite
-- write actually de-duplicate instead of stacking rows on a repeated invite.
CREATE UNIQUE INDEX IF NOT EXISTS "LiveSessionCoTutor_sessionId_tutorId_key"
    ON "LiveSessionCoTutor"("sessionId", "tutorId");

-- ADD CONSTRAINT has no IF NOT EXISTS, so each foreign key is guarded by name.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveSessionCoTutor_sessionId_fkey') THEN
        ALTER TABLE "LiveSessionCoTutor"
            ADD CONSTRAINT "LiveSessionCoTutor_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveSessionCoTutor_tutorId_fkey') THEN
        ALTER TABLE "LiveSessionCoTutor"
            ADD CONSTRAINT "LiveSessionCoTutor_tutorId_fkey"
            FOREIGN KEY ("tutorId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveSessionCoTutor_invitedById_fkey') THEN
        ALTER TABLE "LiveSessionCoTutor"
            ADD CONSTRAINT "LiveSessionCoTutor_invitedById_fkey"
            FOREIGN KEY ("invitedById") REFERENCES "User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
