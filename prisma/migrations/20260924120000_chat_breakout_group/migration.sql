-- Breakout-scoped chat.
--
-- Breakout chat used to go to the whole class: a message typed in Group A
-- showed up in Group B, live and again in history after a reload. Messages sent
-- inside a group now carry that group, and history is filtered by it.
--
-- Additive and nullable (existing rows are whole-class messages), and written
-- idempotently like the other recent migrations, since this database is also
-- synced with `prisma db push`.

ALTER TABLE "LiveSessionChatMessage" ADD COLUMN IF NOT EXISTS "breakoutGroupId" TEXT;
ALTER TABLE "LiveSessionChatMessage" ADD COLUMN IF NOT EXISTS "breakoutGroupName" TEXT;

CREATE INDEX IF NOT EXISTS "LiveSessionChatMessage_sessionId_breakoutGroupId_idx"
  ON "LiveSessionChatMessage"("sessionId", "breakoutGroupId");
