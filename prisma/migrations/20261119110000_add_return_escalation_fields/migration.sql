-- CreateEnum
CREATE TYPE "EscalationType" AS ENUM ('AUTO', 'CUSTOMER');

-- AlterTable
ALTER TABLE "return_requests"
ADD COLUMN "escalatedAt" TIMESTAMP(3),
ADD COLUMN "escalationReason" TEXT,
ADD COLUMN "escalationType" "EscalationType";
