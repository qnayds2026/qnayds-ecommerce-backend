
const {
  paymentPayloadSchema,
  refundPayloadSchema,
} = require("./webhooks.validation");

const {
  STATUS,
  canTransition,
  paiseToDecimalString,
  amountMatches,
} = require("../payments/payment-state");

const hooks = require("./webhooks.hooks");

// Each handler returns a short outcome string stored on the webhook event row.

async function findPaymentByGatewayOrder(tx, gatewayOrderId) {
  if (!gatewayOrderId) return null;

  return tx.payment.findUnique({
    where: { gatewayOrderId },
  });
}

async function flagMismatch(tx, payment, reason, notifications) {
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      requiresReview: true,
      reviewReason: reason,
    },
  });

  console.warn("[webhook] payment flagged for review", {
    paymentId: payment.id,
    reason,
  });

  await hooks.notifyAdmins(tx, notifications, {
    type: "PAYMENT_FLAGGED_FOR_REVIEW",
    title: "Payment flagged for review",
    message:
      "Payment " +
      payment.id +
      " was flagged because the gateway payment details did not match. Please review it.",
    link: "/admin/orders",
    dedupeKey: "PAYMENT_FLAGGED_FOR_REVIEW:" + payment.id,
  });

  return "AMOUNT_MISMATCH";
}

// Shared by authorized / captured / failed.
async function applyPaymentEvent(
  tx,
  { eventId, event, target, notifications }
) {
  const { payment: wrap } = paymentPayloadSchema.parse(event.payload);
  const entity = wrap.entity;

  const payment = await findPaymentByGatewayOrder(tx, entity.order_id);

  if (!payment) return "IGNORED_UNKNOWN_ORDER";

  // Never trust the gateway blindly: amount + currency must match what the server calculated.
  if (target !== STATUS.FAILED) {
    if (
      !amountMatches(payment.amount, entity.amount) ||
      payment.currency !== entity.currency
    ) {
      return flagMismatch(
        tx,
        payment,
        `gateway ${entity.amount} ${entity.currency} != expected`,
        notifications
      );
    }
  }

  if (!canTransition(payment.status, target)) return "NO_CHANGE";

  const now = new Date();

  const data = {
    status: target,
    gatewayPaymentId: entity.id,
    lastEventId: eventId,
  };

  if (target === STATUS.AUTHORIZED) data.authorizedAt = now;
  if (target === STATUS.CAPTURED) data.capturedAt = now;

  if (target === STATUS.FAILED) {
    data.failedAt = now;
    data.failureCode = entity.error_code || null;
    data.failureReason = entity.error_description || null;
  }

  const updated = await tx.payment.update({
    where: { id: payment.id },
    data,
  });

  if (target === STATUS.CAPTURED) {
    await hooks.onPaymentCaptured(tx, updated, notifications);
  }

  if (target === STATUS.FAILED) {
    await hooks.onPaymentFailed(tx, updated, notifications);
  }

  return "APPLIED";
}

// Refunds are tracked in their own table; the payment status is derived from them.
async function applyRefundEvent(
  tx,
  { eventId, event, refundStatus, notifications }
) {
  const { refund: wrap } = refundPayloadSchema.parse(event.payload);
  const entity = wrap.entity;

  const payment = await tx.payment.findFirst({
    where: { gatewayPaymentId: entity.payment_id },
  });

  if (!payment) return "IGNORED_UNKNOWN_PAYMENT";

  const refundRow = await tx.paymentRefund.upsert({
    where: { gatewayRefundId: entity.id },
    create: {
      paymentId: payment.id,
      gatewayRefundId: entity.id,
      amount: paiseToDecimalString(entity.amount),
      currency: entity.currency,
      status: refundStatus,
      lastEventId: eventId,
    },
    update: {
      status: refundStatus,
      lastEventId: eventId,
    },
  });

  await hooks.onRefundEvent(tx, {
    refundRow,
    refundStatus,
    notes: entity.notes,
    notifications,
  });

  const sums = await tx.paymentRefund.groupBy({
    by: ["status"],
    where: { paymentId: payment.id },
    _sum: { amount: true },
  });

  const sumOf = (status) =>
    sums.find((item) => item.status === status)?._sum.amount;

  const processed = sumOf("PROCESSED");
  const pending = sumOf("PENDING");

  let next = payment.status;

  if (processed && processed.gte(payment.amount)) {
    next = STATUS.REFUNDED;
  } else if (
    pending &&
    pending.gt(0) &&
    payment.status === STATUS.CAPTURED
  ) {
    next = STATUS.REFUND_PENDING;
  } else if (
    payment.status === STATUS.REFUND_PENDING &&
    !(pending && pending.gt(0))
  ) {
    next = STATUS.CAPTURED;
  }

  if (next === payment.status) return "REFUND_RECORDED";

  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: next,
      lastEventId: eventId,
    },
  });

  if (next === STATUS.REFUNDED) {
    await hooks.onPaymentRefunded(tx, updated, notifications);
  }

  return "APPLIED";
}

const handlers = {
  "payment.authorized": (tx, ctx) =>
    applyPaymentEvent(tx, {
      ...ctx,
      target: STATUS.AUTHORIZED,
    }),

  "payment.captured": (tx, ctx) =>
    applyPaymentEvent(tx, {
      ...ctx,
      target: STATUS.CAPTURED,
    }),

  "payment.failed": (tx, ctx) =>
    applyPaymentEvent(tx, {
      ...ctx,
      target: STATUS.FAILED,
    }),

  "refund.created": (tx, ctx) =>
    applyRefundEvent(tx, {
      ...ctx,
      refundStatus: "PENDING",
    }),

  "refund.processed": (tx, ctx) =>
    applyRefundEvent(tx, {
      ...ctx,
      refundStatus: "PROCESSED",
    }),

  "refund.failed": (tx, ctx) =>
    applyRefundEvent(tx, {
      ...ctx,
      refundStatus: "FAILED",
    }),

  // order.paid: payment.captured already drives the state change.
  "order.paid": async () => "NO_CHANGE",
};

module.exports = { handlers };
