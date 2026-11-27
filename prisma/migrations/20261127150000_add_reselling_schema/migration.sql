-- CreateEnum
CREATE TYPE "ResellerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BankVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResellerEarningStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'IN_SETTLEMENT', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResellerEarningEventType" AS ENUM ('ACCRUED', 'ELIGIBLE', 'ADJUSTED', 'CANCELLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "ResellerSettlementStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'PAID', 'FAILED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'RESELLER';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "resellerMargin" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "resellerId" TEXT,
ADD COLUMN     "resellerMarginTotal" DECIMAL(12,2),
ADD COLUMN     "resellerShareId" TEXT,
ADD COLUMN     "shippingCharge" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isResellable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reseller_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "status" "ResellerStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_bank_accounts" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "verificationStatus" "BankVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "rejectionReason" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_product_shares" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_product_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_earnings" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ResellerEarningStatus" NOT NULL DEFAULT 'PENDING',
    "eligibleAt" TIMESTAMP(3),
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_earning_events" (
    "id" TEXT NOT NULL,
    "earningId" TEXT NOT NULL,
    "type" "ResellerEarningEventType" NOT NULL,
    "amountDelta" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_earning_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_settlements" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "ResellerSettlementStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectionReason" TEXT,
    "method" TEXT,
    "paymentReference" TEXT,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reseller_profiles_userId_key" ON "reseller_profiles"("userId");

-- CreateIndex
CREATE INDEX "reseller_profiles_status_idx" ON "reseller_profiles"("status");

-- CreateIndex
CREATE INDEX "reseller_bank_accounts_resellerId_idx" ON "reseller_bank_accounts"("resellerId");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_product_shares_code_key" ON "reseller_product_shares"("code");

-- CreateIndex
CREATE INDEX "reseller_product_shares_productId_idx" ON "reseller_product_shares"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_product_shares_resellerId_productId_key" ON "reseller_product_shares"("resellerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_earnings_orderItemId_key" ON "reseller_earnings"("orderItemId");

-- CreateIndex
CREATE INDEX "reseller_earnings_resellerId_status_idx" ON "reseller_earnings"("resellerId", "status");

-- CreateIndex
CREATE INDEX "reseller_earnings_orderId_idx" ON "reseller_earnings"("orderId");

-- CreateIndex
CREATE INDEX "reseller_earnings_settlementId_idx" ON "reseller_earnings"("settlementId");

-- CreateIndex
CREATE INDEX "reseller_earning_events_earningId_createdAt_idx" ON "reseller_earning_events"("earningId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_settlements_paymentReference_key" ON "reseller_settlements"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_settlements_idempotencyKey_key" ON "reseller_settlements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "reseller_settlements_resellerId_status_idx" ON "reseller_settlements"("resellerId", "status");

-- CreateIndex
CREATE INDEX "reseller_settlements_bankAccountId_idx" ON "reseller_settlements"("bankAccountId");

-- CreateIndex
CREATE INDEX "orders_resellerId_createdAt_idx" ON "orders"("resellerId", "createdAt");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "reseller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_resellerShareId_fkey" FOREIGN KEY ("resellerShareId") REFERENCES "reseller_product_shares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_profiles" ADD CONSTRAINT "reseller_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_bank_accounts" ADD CONSTRAINT "reseller_bank_accounts_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "reseller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_product_shares" ADD CONSTRAINT "reseller_product_shares_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "reseller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_product_shares" ADD CONSTRAINT "reseller_product_shares_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_earnings" ADD CONSTRAINT "reseller_earnings_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "reseller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_earnings" ADD CONSTRAINT "reseller_earnings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_earnings" ADD CONSTRAINT "reseller_earnings_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_earnings" ADD CONSTRAINT "reseller_earnings_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "reseller_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_earning_events" ADD CONSTRAINT "reseller_earning_events_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "reseller_earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_settlements" ADD CONSTRAINT "reseller_settlements_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "reseller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_settlements" ADD CONSTRAINT "reseller_settlements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "reseller_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

