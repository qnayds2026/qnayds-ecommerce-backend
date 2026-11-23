-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('UPI', 'BANK');

-- AlterTable
ALTER TABLE "return_requests" ADD COLUMN     "manualRefundReference" TEXT,
ADD COLUMN     "refundAccountName" TEXT,
ADD COLUMN     "refundAccountNumber" TEXT,
ADD COLUMN     "refundIfsc" TEXT,
ADD COLUMN     "refundMethod" "RefundMethod",
ADD COLUMN     "refundUpiId" TEXT;

