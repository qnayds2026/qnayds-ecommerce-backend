
const { confirmOrder } = require("../payments/order-confirmation");

const CHANGED_BY = "system:razorpay-webhook";

// Queue notification data. Actual DB creation happens after webhook transaction commits.
function queueNotification(notifications, data) {
  if (!Array.isArray(notifications)) return;

  if (
    !data ||
    !data.userId ||
    !data.type ||
    !data.title ||
    !data.message ||
    !data.dedupeKey
  ) {
    return;
  }

  notifications.push(data);
}

// Queue notifications for all admins.
async function notifyAdmins(tx, notifications, data) {
  try {
    const admins = await tx.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    for (const admin of admins) {
      queueNotification(notifications, {
        ...data,
        userId: admin.id,
        dedupeKey: String(data.dedupeKey) + ":" + String(admin.id),
      });
    }

    return admins;
  } catch (error) {
    console.error("Admin notification lookup failed:", error.message);
    return [];
  }
}

async function onPaymentCaptured(tx, payment, notifications) {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: {
      id: true,
      status: true,
      userId: true,
      orderNumber: true,
    },
  });

  if (!order) {
    throw new Error("Order not found for captured payment");
  }

  if (order.status === "CANCELLED") {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        requiresReview: true,
        reviewReason:
          "Payment captured but order is CANCELLED; refund required",
      },
    });

    await notifyAdmins(tx, notifications, {
      type: "PAYMENT_FLAGGED_FOR_REVIEW",
      title: "Payment flagged for review",
      message:
        "Payment was captured for cancelled order " +
        order.orderNumber +
        ". Please review and arrange a refund if required.",
      link: "/admin/orders/" + order.id,
      dedupeKey: "PAYMENT_FLAGGED_FOR_REVIEW:" + payment.id,
    });

    return;
  }

  const confirmationStatus = await confirmOrder(tx, payment.orderId, {
    changedBy: CHANGED_BY,
    note: "Payment captured",
  });

  if (confirmationStatus === "CONFIRMED") {
    queueNotification(notifications, {
      userId: order.userId,
      type: "ORDER_CONFIRMED",
      title: "Order confirmed",
      message:
        "Your order " + order.orderNumber + " has been confirmed.",
      link: "/orders/" + order.id,
      dedupeKey:
        "ORDER_CONFIRMED:" + order.userId + ":" + order.id,
    });
  }

  queueNotification(notifications, {
    userId: order.userId,
    type: "PAYMENT_SUCCESS",
    title: "Payment successful",
    message:
      "Payment for order " + order.orderNumber + " was successful.",
    link: "/orders/" + order.id,
    dedupeKey:
      "PAYMENT_SUCCESS:" + order.userId + ":" + payment.id,
  });
}

async function onPaymentFailed(tx, payment, notifications) {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: {
      id: true,
      userId: true,
      orderNumber: true,
    },
  });

  if (!order) {
    throw new Error("Order not found for failed payment");
  }

  queueNotification(notifications, {
    userId: order.userId,
    type: "PAYMENT_FAILED",
    title: "Payment failed",
    message:
      "Payment for order " +
      order.orderNumber +
      " failed. Please try again.",
    link: "/orders/" + order.id,
    dedupeKey:
      "PAYMENT_FAILED:" + order.userId + ":" + payment.id,
  });
}

async function onPaymentRefunded(tx, payment, notifications) {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    include: { sellerOrders: true },
  });

  if (!order || order.status !== "DELIVERED") {
    return;
  }

  const parent = await tx.order.updateMany({
    where: {
      id: order.id,
      status: "DELIVERED",
    },
    data: {
      status: "REFUNDED",
    },
  });

  if (parent.count !== 1) {
    throw new Error("Order status changed during refund");
  }

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
    if (sellerOrder.status !== "DELIVERED") {
      continue;
    }

    const updated = await tx.sellerOrder.updateMany({
      where: {
        id: sellerOrder.id,
        status: "DELIVERED",
      },
      data: {
        status: "REFUNDED",
      },
    });

    if (updated.count !== 1) {
      throw new Error("Seller order status changed during refund");
    }

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

  queueNotification(notifications, {
    userId: order.userId,
    type: "REFUND_COMPLETED",
    title: "Refund completed",
    message:
      "Refund for order " + order.orderNumber + " has been completed.",
    link: "/orders/" + order.id,
    dedupeKey:
      "REFUND_COMPLETED:" + order.userId + ":" + payment.id,
  });
}

async function onRefundEvent(
  tx,
  { refundRow, refundStatus, notes, notifications }
) {
  const returnId = notes && notes.returnId;

  const ret = await tx.returnRequest.findFirst({
    where: {
      OR: [
        { paymentRefundId: refundRow.id },
        ...(returnId ? [{ id: returnId }] : []),
      ],
    },
    include: {
      sellerOrder: {
        include: {
          seller: {
            select: { userId: true },
          },
        },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
        },
      },
    },
  });

  if (!ret) {
    return;
  }

  if (ret.paymentRefundId && ret.paymentRefundId !== refundRow.id) {
    return;
  }

  if (!ret.paymentRefundId) {
    await tx.returnRequest.update({
      where: { id: ret.id },
      data: {
        paymentRefundId: refundRow.id,
      },
    });
  }

  if (refundStatus === "PROCESSED") {
    const updated = await tx.returnRequest.updateMany({
      where: {
        id: ret.id,
        status: {
          in: ["REFUND_INITIATED", "REFUND_FAILED"],
        },
      },
      data: {
        status: "REFUNDED",
        refundedAt: new Date(),
      },
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

      queueNotification(notifications, {
        userId: ret.userId,
        type: "REFUND_COMPLETED",
        title: "Refund completed",
        message:
          "Refund for return " +
          ret.returnNumber +
          " has been completed.",
        link: "/returns/" + ret.id,
        dedupeKey:
          "RETURN_REFUND_COMPLETED_CUSTOMER:" +
          ret.id +
          ":" +
          ret.userId,
      });

      const sellerUserId =
        ret.sellerOrder &&
        ret.sellerOrder.seller &&
        ret.sellerOrder.seller.userId;

      if (sellerUserId) {
        queueNotification(notifications, {
          userId: sellerUserId,
          type: "RETURN_REFUND_COMPLETED",
          title: "Return refund completed",
          message:
            "The refund for return " +
            ret.returnNumber +
            " has been completed.",
          link: "/seller/returns/" + ret.id,
          dedupeKey:
            "RETURN_REFUND_COMPLETED_SELLER:" +
            ret.id +
            ":" +
            sellerUserId,
        });
      }
    }
  }

  if (refundStatus === "FAILED") {
    const updated = await tx.returnRequest.updateMany({
      where: {
        id: ret.id,
        status: "REFUND_INITIATED",
      },
      data: {
        status: "REFUND_FAILED",
        refundIdempotencyKey: null,
      },
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

      await notifyAdmins(tx, notifications, {
        type: "REFUND_FAILED",
        title: "Refund failed",
        message:
          "Refund for return " +
          ret.returnNumber +
          " failed at the payment provider. Please review it.",
        link: "/admin/returns/" + ret.id,
        dedupeKey:
          "REFUND_FAILED:" + ret.id + ":" + refundRow.id,
      });
    }
  }
}

module.exports = {
  onPaymentCaptured,
  onPaymentFailed,
  onPaymentRefunded,
  onRefundEvent,
  notifyAdmins,
};
