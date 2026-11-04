const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");
const razorpay = require("./razorpay.service");
const { canTransition } = require("./payment-state");
const { handlers } = require("../webhooks/razorpay.events");

// Attempts that can still complete; a new attempt is not created while one of these exists.
const OPEN_STATUSES = ["CREATED", "PENDING", "AUTHORIZED"];
const MAX_ATTEMPTS = 5;
const MIN_AMOUNT_PAISE = 100; // Razorpay minimum: 1 INR

// Fields a customer is allowed to see. Review flags and event ids stay internal.
const PUBLIC_SELECT = {
  id: true,
  orderId: true,
  method: true,
  status: true,
  amount: true,
  currency: true,
  gatewayOrderId: true,
  gatewayPaymentId: true,
  failureReason: true,
  createdAt: true,
  capturedAt: true,
  failedAt: true,
};

// What the frontend needs to open Razorpay Checkout. Never includes the Key Secret.
function toClientDetails(payment) {
  return {
    paymentId: payment.id,
    keyId: razorpay.getKeyId(),
    gatewayOrderId: payment.gatewayOrderId,
    amount: razorpay.toPaise(payment.amount),
    currency: payment.currency,
    status: payment.status,
  };
}

async function createAttempt(order) {
  // Amount always comes from the order stored in the DB, never from the client.
  const amountPaise = razorpay.toPaise(order.totalAmount);

  if (amountPaise < MIN_AMOUNT_PAISE) {
    throw ApiError.badRequest("Order amount is below the minimum payable amount");
  }

  const gatewayOrder = await razorpay.createGatewayOrder({
    amountPaise,
    currency: order.currency,
    receipt: order.orderNumber,
    notes: { orderId: order.id },
  });

  // Persist immediately, so a very fast webhook can always find this attempt.
  return prisma.payment.create({
    data: {
      orderId: order.id,
      userId: order.userId,
      gatewayOrderId: gatewayOrder.id,
      amount: order.totalAmount,
      currency: order.currency,
      status: "CREATED",
    },
  });
}

// Reuses an open attempt, otherwise creates a new one. Old (failed) attempts are never touched.
async function startPaymentForOrder(order) {
  if (order.status !== "PENDING_PAYMENT") {
    throw ApiError.conflict("Order is not awaiting payment");
  }

  const open = await prisma.payment.findFirst({
    where: { orderId: order.id, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    // A pending COD row is "open" too. It must never be handed out as an online attempt.
    if (open.method === "COD") {
      throw ApiError.conflict("This order is Cash on Delivery");
    }
    return open;
  }

  const attempts = await prisma.payment.count({ where: { orderId: order.id } });
  if (attempts >= MAX_ATTEMPTS) {
    throw ApiError.conflict("Maximum payment attempts reached for this order");
  }

  return createAttempt(order);
}

// COD: no gateway order. One PENDING row with method COD; the same order reuses it.
async function startCodPaymentForOrder(order) {
  if (order.status !== "PENDING_PAYMENT") {
    throw ApiError.conflict("Order is not awaiting payment");
  }

  const existing = await prisma.payment.findFirst({
    where: { orderId: order.id, method: "COD" },
  });
  if (existing) return existing;

  // An order is paid online or by COD, never both (e.g. same Idempotency-Key sent with another method).
  const online = await prisma.payment.findFirst({
    where: { orderId: order.id, method: "ONLINE" },
    select: { id: true },
  });
  if (online) {
    throw ApiError.conflict("This order already has an online payment");
  }

  return prisma.payment.create({
    data: {
      orderId: order.id,
      userId: order.userId,
      amount: order.totalAmount,
      currency: order.currency,
      status: "PENDING",
      method: "COD",
    },
  });
}

// What the frontend needs for a COD order. No Razorpay key or gateway order.
function toCodDetails(payment) {
  return {
    paymentId: payment.id,
    method: "COD",
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
  };
}

/**
 * Admin marks the cash of a COD order as collected (PENDING -> CAPTURED).
 * Allowed only once the order is DELIVERED. Idempotent: an already collected payment is returned unchanged.
 */
async function collectCodPayment(user, paymentId) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (payment.method !== "COD") {
    throw ApiError.badRequest("Only COD payments can be marked as collected");
  }

  if (payment.status === "CAPTURED") {
    return prisma.payment.findUnique({ where: { id: payment.id }, select: PUBLIC_SELECT });
  }

  if (!canTransition(payment.status, "CAPTURED")) {
    throw ApiError.conflict(`Payment cannot be collected from ${payment.status}`);
  }

  const order = await prisma.order.findUnique({
    where: { id: payment.orderId },
    select: { status: true },
  });
  if (!order || order.status !== "DELIVERED") {
    throw ApiError.conflict("Cash can be marked as collected only after the order is delivered");
  }

  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, method: "COD", status: payment.status },
    data: { status: "CAPTURED", capturedAt: new Date() },
  });
  if (updated.count !== 1) {
    throw ApiError.conflict("Payment status changed. Please refresh and try again.");
  }

  return prisma.payment.findUnique({ where: { id: payment.id }, select: PUBLIC_SELECT });
}

async function createRazorpayOrder(user, { orderId }) {
  razorpay.assertConfigured();

  // Looked up by owner: someone else's order looks exactly like a missing one.
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
  });
  if (!order) throw ApiError.notFound("Order not found");

  const payment = await startPaymentForOrder(order);
  if (payment.method === "COD") {
    throw ApiError.conflict("This order is Cash on Delivery");
  }
  return toClientDetails(payment);
}

async function verifyPayment(user, body) {
  const gatewayOrderId = body.razorpay_order_id;
  const gatewayPaymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;

  const payment = await prisma.payment.findFirst({
    where: { gatewayOrderId, userId: user.id },
  });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (!razorpay.verifyPaymentSignature({ gatewayOrderId, gatewayPaymentId, signature })) {
    throw ApiError.badRequest("Invalid payment signature");
  }

  // A valid signature alone never marks the order paid. Confirm with Razorpay server-to-server,
  // then apply the same state change the webhook would (shared handlers, so they cannot disagree).
  const gatewayPayment = await razorpay.fetchGatewayPayment(gatewayPaymentId);
  if (gatewayPayment.order_id !== gatewayOrderId) {
    throw ApiError.badRequest("Payment does not belong to this order");
  }

  const eventName = {
    captured: "payment.captured",
    authorized: "payment.authorized",
    failed: "payment.failed",
  }[gatewayPayment.status];

  if (eventName) {
    try {
      await prisma.$transaction(
        (tx) =>
          handlers[eventName](tx, {
            eventId: `verify_${gatewayPaymentId}`,
            event: {
              event: eventName,
              payload: { payment: { entity: gatewayPayment } },
            },
          }),
        { timeout: 10000 }
      );
    } catch (err) {
      // A concurrent webhook most likely won the race. The webhook stays the source of truth.
      console.error("[payments] verify could not apply state", {
        paymentId: payment.id,
        error: err.message,
      });
    }
  }

  return prisma.payment.findFirst({
    where: { id: payment.id },
    select: PUBLIC_SELECT,
  });
}

async function getPayment(user, paymentId) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: user.id },
    select: PUBLIC_SELECT,
  });
  if (!payment) throw ApiError.notFound("Payment not found");
  return payment;
}

async function retryPayment(user, paymentId) {
  razorpay.assertConfigured();

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: user.id },
  });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (payment.status !== "FAILED") {
    throw ApiError.conflict("Only failed payments can be retried");
  }

  const order = await prisma.order.findFirst({
    where: { id: payment.orderId, userId: user.id },
  });
  if (!order) throw ApiError.notFound("Order not found");

  const next = await startPaymentForOrder(order);
  return toClientDetails(next);
}

module.exports = {
  createRazorpayOrder,
  verifyPayment,
  getPayment,
  retryPayment,
  startPaymentForOrder,
  toClientDetails,
  startCodPaymentForOrder,
  toCodDetails,
  collectCodPayment,
};