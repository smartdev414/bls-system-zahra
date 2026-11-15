-- CreateEnum
CREATE TYPE "ReceptiveActivity" AS ENUM ('TV', 'FILM', 'ONLINE', 'DEAF_EVENT', 'MET_DEAF', 'OTHER');

-- CreateTable
CREATE TABLE "ReceptiveLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "activity" "ReceptiveActivity" NOT NULL,
    "title" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceptiveLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceptiveLog_userId_date_idx" ON "ReceptiveLog"("userId", "date");

-- AddForeignKey
ALTER TABLE "ReceptiveLog" ADD CONSTRAINT "ReceptiveLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
