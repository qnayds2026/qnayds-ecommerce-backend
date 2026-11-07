// Moves an order and its seller orders from PENDING_PAYMENT to CONFIRMED, with status history.
// Runs inside the caller's transaction (`tx`) so it commits or rolls back with the payment change.
// Idempotent: an order that is not PENDING_PAYMENT is left untouched and its current status returned.
// Shared by the Razorpay webhook (payment captured) and the COD checkout, so both confirm orders identically.

async function confirmOrder(tx, orderId, { changedBy, note }) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { sellerOrders: true },
  });

  if (!order) throw new Error("Order not found");
  if (order.status !== "PENDING_PAYMENT") return order.status;

  const parent = await tx.order.updateMany({
    where: { id: order.id, status: "PENDING_PAYMENT" },
    data: { status: "CONFIRMED" },
  });

  // Order changed while we were processing: throw so the transaction rolls back and can be retried.
  if (parent.count !== 1) throw new Error("Order status changed during confirmation");

  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      oldStatus: "PENDING_PAYMENT",
      newStatus: "CONFIRMED",
      changedBy,
      note,
    },
  });

  for (const sellerOrder of order.sellerOrders) {
    if (sellerOrder.status !== "PENDING_PAYMENT") continue;

    const updated = await tx.sellerOrder.updateMany({
      where: { id: sellerOrder.id, status: "PENDING_PAYMENT" },
      data: { status: "CONFIRMED" },
    });
    if (updated.count !== 1) throw new Error("Seller order status changed during confirmation");

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        sellerOrderId: sellerOrder.id,
        oldStatus: "PENDING_PAYMENT",
        newStatus: "CONFIRMED",
        changedBy,
        note,
      },
    });
  }

  return "CONFIRMED";
}

module.exports = { confirmOrder };