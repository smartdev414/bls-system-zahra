-- Why a class was cancelled, and when.
ALTER TABLE "LiveSession" ADD COLUMN "cancelNote" TEXT;
ALTER TABLE "LiveSession" ADD COLUMN "cancelledAt" TIMESTAMP(3);
