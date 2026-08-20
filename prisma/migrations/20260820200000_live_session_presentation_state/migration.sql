-- Durable snapshot of what the tutor currently has on the classroom stage, so
-- late joiners and reloading students can hydrate without a peer to ask.
CREATE TABLE "LiveSessionPresentation" (
    "sessionId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT,
    "url" TEXT,
    "page" INTEGER NOT NULL DEFAULT 1,
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "selectedPages" JSONB,
    "videoPlaying" BOOLEAN NOT NULL DEFAULT false,
    "videoTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSessionPresentation_pkey" PRIMARY KEY ("sessionId")
);

ALTER TABLE "LiveSessionPresentation"
    ADD CONSTRAINT "LiveSessionPresentation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
