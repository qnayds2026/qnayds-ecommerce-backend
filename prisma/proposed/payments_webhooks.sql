-- PROPOSED by Teammate 1 (checkout & payments) for Team Lead review.
-- Not applied. Do NOT run as a migration; the Team Lead owns schema.prisma and migrations.
-- Naming follows schema.prisma conventions (cuid string ids, snake_case @@map tables).
-- FKs point to the existing "orders" and "users" tables.
-- Order creation/confirmation contract and stock reservation timing are still to be agreed.

CREATE TYPE "PaymentStatus" AS ENUM (
  'CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUND_PENDING', 'REFUNDED'
);

-- One row per payment ATTEMPT. Retries create a new row, so failures are never overwritten.
-- Checkout duplicate protection already exists on orders (userId, idempotencyKey).
CREATE TABLE "payments" (
  "id"                TEXT PRIMARY KEY,
  "orderId"           TEXT NOT NULL REFERENCES "orders"("id"),
  "userId"            TEXT NOT NULL REFERENCES "users"("id"),
  "gatewayOrderId"    TEXT NOT NULL UNIQUE,         -- Razorpay order_id
  "gatewayPaymentId"  TEXT,                         -- Razorpay payment id (set on first payment event)
  "amount"            DECIMAL(12,2) NOT NULL,       -- rupees, server-calculated
  "currency"          CHAR(3) NOT NULL DEFAULT 'INR',
  "status"            "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "authorizedAt"      TIMESTAMP(3),
  "capturedAt"        TIMESTAMP(3),
  "failedAt"          TIMESTAMP(3),
  "failureCode"       TEXT,
  "failureReason"     TEXT,
  "lastEventId"       TEXT,
  "requiresReview"    BOOLEAN NOT NULL DEFAULT FALSE, -- set on amount/currency mismatch
  "reviewReason"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL
);
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");
CREATE INDEX "payments_userId_idx" ON "payments"("userId");
CREATE INDEX "payments_gatewayPaymentId_idx" ON "payments"("gatewayPaymentId");

CREATE TABLE "payment_refunds" (
  "id"               TEXT PRIMARY KEY,
  "paymentId"        TEXT NOT NULL REFERENCES "payments"("id"),
  "gatewayRefundId"  TEXT NOT NULL UNIQUE,
  "amount"           DECIMAL(12,2) NOT NULL,
  "currency"         CHAR(3) NOT NULL,
  "status"           TEXT NOT NULL,                 -- PENDING | PROCESSED | FAILED
  "lastEventId"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL
);
CREATE INDEX "payment_refunds_paymentId_idx" ON "payment_refunds"("paymentId");

-- Webhook idempotency + audit trail. UNIQUE("eventId") is what stops duplicate processing.
CREATE TABLE "webhook_events" (
  "id"           TEXT PRIMARY KEY,
  "eventId"      TEXT NOT NULL UNIQUE,              -- X-Razorpay-Event-Id
  "provider"     TEXT NOT NULL DEFAULT 'RAZORPAY',
  "eventType"    TEXT NOT NULL,
  "status"       TEXT NOT NULL,                     -- PROCESSING | PROCESSED
  "outcome"      TEXT,                              -- APPLIED | NO_CHANGE | AMOUNT_MISMATCH | IGNORED_*
  "payload"      JSONB NOT NULL,
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"  TIMESTAMP(3)
);
CREATE INDEX "webhook_events_eventType_idx" ON "webhook_events"("eventType");