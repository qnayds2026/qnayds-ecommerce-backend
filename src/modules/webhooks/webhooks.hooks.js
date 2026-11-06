// Called INSIDE the webhook DB transaction (`tx`), so the order change commits or rolls back
// together with the payment status change.

const { confirmOrder } = require("../payments/order-confirmation");

const CHANGED_BY = "system:razorpay-webhook";

async function onPaymentCaptured(tx, payment) {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { status: true },
  });

  if (!order) throw new Error("Order not found for captured payment");

  if (order.status === "CANCELLED") {
    // Customer cancelled before the payment arrived: money was taken for a cancelled order.
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        requiresReview: true,
        reviewReason: "Payment captured but order is CANCELLED; refund required",
      },
    });
    return;
  }

  // No-op if the order is already confirmed or has moved on (idempotent).
  await confirmOrder(tx, payment.orderId, {
    changedBy: CHANGED_BY,
    note: "Payment captured",
  });

  // TODO (Team Lead): stock commit timing is undecided; reserved stock is left untouched for now.
}

async function onPaymentFailed(tx, payment) {
  // Intentionally nothing: the order stays PENDING_PAYMENT with its stock reserved,
  // so the customer can retry payment. Expiry/auto-cancel of abandoned orders is a Team Lead decision.
}

async function onPaymentRefunded(tx, payment) {
  // Per order-status.js only a DELIVERED order may move to REFUNDED. Cancelled orders stay CANCELLED;
  // the refund itself is tracked on the payment (REFUNDED) and in payment_refunds.
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    include: { sellerOrders: true },
  });
  if (!order || order.status !== "DELIVERED") return;

  const parent = await tx.order.updateMany({
    where: { id: order.id, status: "DELIVERED" },
    data: { status: "REFUNDED" },
  });
  if (parent.count !== 1) throw new Error("Order status changed during refund");

  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      oldStatus: "DELIVERED",
      newStatus: "REFUNDED",
      changedBy: CHANGED_BY,
      note: "Payment refunded",
    },
  });

  for (const sellerOrder of order.sellerOrders) {
    if (sellerOrder.status !== "DELIVERED") continue;

    const updated = await tx.sellerOrder.updateMany({
      where: { id: sellerOrder.id, status: "DELIVERED" },
      data: { status: "REFUNDED" },
    });
    if (updated.count !== 1) throw new Error("Seller order status changed during refund");

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        sellerOrderId: sellerOrder.id,
        oldStatus: "DELIVERED",
        newStatus: "REFUNDED",
        changedBy: CHANGED_BY,
        note: "Payment refunded",
      },
    });
  }
}

// Keeps a return in step with its Razorpay refund. Only the gateway can make a return REFUNDED.
async function onRefundEvent(tx, { refundRow, refundStatus, notes }) {
  const returnId = notes && notes.returnId;
  const ret = await tx.returnRequest.findFirst({
    where: {
      OR: [{ paymentRefundId: refundRow.id }, ...(returnId ? [{ id: returnId }] : [])],
    },
  });
  if (!ret) return; // a refund that is not for a return

  // A late event of an older, failed refund attempt must not change a retried return.
  if (ret.paymentRefundId && ret.paymentRefundId !== refundRow.id) return;

  if (!ret.paymentRefundId) {
    await tx.returnRequest.update({
      where: { id: ret.id },
      data: { paymentRefundId: refundRow.id },
    });
  }

  if (refundStatus === "PROCESSED") {
    // REFUND_FAILED is allowed too: our call may have timed out although Razorpay did refund.
    const updated = await tx.returnRequest.updateMany({
      where: { id: ret.id, status: { in: ["REFUND_INITIATED", "REFUND_FAILED"] } },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });
    if (updated.count === 1) {
      await tx.returnStatusHistory.create({
        data: {
          returnId: ret.id,
          oldStatus: ret.status,
          newStatus: "REFUNDED",
          changedBy: CHANGED_BY,
          actorRole: "SYSTEM",
          note: "Refund confirmed by payment provider",
        },
      });
    }
  }

  if (refundStatus === "FAILED") {
    const updated = await tx.returnRequest.updateMany({
      where: { id: ret.id, status: "REFUND_INITIATED" },
      data: { status: "REFUND_FAILED", refundIdempotencyKey: null },
    });
    if (updated.count === 1) {
      await tx.returnStatusHistory.create({
        data: {
          returnId: ret.id,
          oldStatus: "REFUND_INITIATED",
          newStatus: "REFUND_FAILED",
          changedBy: CHANGED_BY,
          actorRole: "SYSTEM",
          note: "Refund failed at payment provider",
        },
      });
    }
  }
}

module.exports = { onPaymentCaptured, onPaymentFailed, onPaymentRefunded, onRefundEvent };