-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "variantAttributes" JSONB,
    "sku" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "deliveryName" TEXT NOT NULL,
    "deliveryPhone" TEXT NOT NULL,
    "deliveryAddressLine1" TEXT NOT NULL,
    "deliveryAddressLine2" TEXT,
    "deliveryCity" TEXT NOT NULL,
    "deliveryState" TEXT NOT NULL,
    "deliveryPostalCode" TEXT NOT NULL,
    "deliveryCountry" TEXT NOT NULL DEFAULT 'India',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_orders" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "trackingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "oldStatus" "OrderStatus",
    "newStatus" "OrderStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sellerOrderId" TEXT,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_sellerOrderId_idx" ON "order_items"("sellerOrderId");

-- CreateIndex
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_userId_idempotencyKey_key" ON "orders"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "seller_orders_sellerId_status_idx" ON "seller_orders"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_orders_orderId_sellerId_key" ON "seller_orders"("orderId", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_sellerOrderId_key" ON "shipments"("sellerOrderId");

-- CreateIndex
CREATE INDEX "order_status_history_orderId_createdAt_idx" ON "order_status_history"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_status_history_changedBy_idx" ON "order_status_history"("changedBy");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

