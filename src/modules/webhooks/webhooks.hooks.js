// Called INSIDE the webhook DB transaction (`tx`), so the order change commits or rolls back
// together with the payment status change.

const CHANGED_BY = "system:razorpay-webhook";

async function onPaymentCaptured(tx, payment) {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    include: { sellerOrders: true },
  });

  if (!order) throw new Error("Order not found for captured payment");

  if (order.status !== "PENDING_PAYMENT") {
    // Already confirmed or moved on: nothing to do (idempotent).
    if (order.status !== "CANCELLED") return;

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

  const parent = await tx.order.updateMany({
    where: { id: order.id, status: "PENDING_PAYMENT" },
    data: { status: "CONFIRMED" },
  });

  // Order changed while we were processing: throw so the transaction rolls back and Razorpay retries.
  if (parent.count !== 1) throw new Error("Order status changed during payment confirmation");

  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      oldStatus: "PENDING_PAYMENT",
      newStatus: "CONFIRMED",
      changedBy: CHANGED_BY,
      note: "Payment captured",
    },
  });

  for (const sellerOrder of order.sellerOrders) {
    if (sellerOrder.status !== "PENDING_PAYMENT") continue;

    const updated = await tx.sellerOrder.updateMany({
      where: { id: sellerOrder.id, status: "PENDING_PAYMENT" },
      data: { status: "CONFIRMED" },
    });
    if (updated.count !== 1) throw new Error("Seller order status changed during payment confirmation");

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        sellerOrderId: sellerOrder.id,
        oldStatus: "PENDING_PAYMENT",
        newStatus: "CONFIRMED",
        changedBy: CHANGED_BY,
        note: "Payment captured",
      },
    });
  }

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

module.exports = { onPaymentCaptured, onPaymentFailed, onPaymentRefunded };