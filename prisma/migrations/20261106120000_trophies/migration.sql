-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TROPHY';

-- CreateTable
CREATE TABLE "Trophy" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "givenById" TEXT,
    "workDone" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trophy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trophy_studentId_idx" ON "Trophy"("studentId");

-- CreateIndex
CREATE INDEX "Trophy_courseId_idx" ON "Trophy"("courseId");

-- AddForeignKey
ALTER TABLE "Trophy" ADD CONSTRAINT "Trophy_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trophy" ADD CONSTRAINT "Trophy_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trophy" ADD CONSTRAINT "Trophy_givenById_fkey" FOREIGN KEY ("givenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
