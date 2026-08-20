-- CreateTable
CREATE TABLE "LiveSessionChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "senderId" TEXT,
    "fromName" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "attachment" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSessionChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveSessionChatMessage_sessionId_createdAt_idx" ON "LiveSessionChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveSessionChatMessage_senderId_idx" ON "LiveSessionChatMessage"("senderId");

-- AddForeignKey
ALTER TABLE "LiveSessionChatMessage" ADD CONSTRAINT "LiveSessionChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSessionChatMessage" ADD CONSTRAINT "LiveSessionChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
