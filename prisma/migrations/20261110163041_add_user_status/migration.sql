-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('READY_TO_SHIP', 'PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURN_TO_ORIGIN');

-- AlterEnum
ALTER TYPE "ProductStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "estimatedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ShipmentStatus" NOT NULL DEFAULT 'READY_TO_SHIP';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "seller_status_histories" (
    "id" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "fromStatus" "SellerStatus" NOT NULL,
    "toStatus" "SellerStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_status_histories" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "fromStatus" "ProductStatus" NOT NULL,
    "toStatus" "ProductStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_status_histories" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "fromStatus" "UserStatus" NOT NULL,
    "toStatus" "UserStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SELLER',
    "actorId" TEXT,
    "providerEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_status_histories_sellerProfileId_createdAt_idx" ON "seller_status_histories"("sellerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "seller_status_histories_adminId_idx" ON "seller_status_histories"("adminId");

-- CreateIndex
CREATE INDEX "product_status_histories_productId_createdAt_idx" ON "product_status_histories"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "product_status_histories_adminId_idx" ON "product_status_histories"("adminId");

-- CreateIndex
CREATE INDEX "customer_status_histories_customerId_createdAt_idx" ON "customer_status_histories"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_status_histories_adminId_idx" ON "customer_status_histories"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_events_providerEventId_key" ON "shipment_events"("providerEventId");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_createdAt_idx" ON "shipment_events"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "shipment_events_status_idx" ON "shipment_events"("status");

-- CreateIndex
CREATE INDEX "shipments_status_updatedAt_idx" ON "shipments"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "seller_status_histories" ADD CONSTRAINT "seller_status_histories_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_status_histories" ADD CONSTRAINT "seller_status_histories_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_status_histories" ADD CONSTRAINT "product_status_histories_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_status_histories" ADD CONSTRAINT "product_status_histories_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_status_histories" ADD CONSTRAINT "customer_status_histories_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_status_histories" ADD CONSTRAINT "customer_status_histories_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
