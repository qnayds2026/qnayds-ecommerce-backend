const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");

const {
  canTransitionShippingStatus,
  SHIPPING_STATUS,
} = require("../modules/shipping/shipping-status");

const {
  canTransitionOrderStatus,
} = require("../modules/orders/order-status");

async function createShipment(user, data) {
  return prisma.$transaction(async (tx) => {
    const seller = await tx.sellerProfile.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!seller) {
      throw ApiError.forbidden("Seller profile required");
    }

    const sellerOrder = await tx.sellerOrder.findFirst({
      where: {
        id: data.sellerOrderId,
        sellerId: seller.id,
      },
      include: {
        order: true,
        shipment: true,
      },
    });

    if (!sellerOrder) {
      throw ApiError.notFound("Seller order not found")
    }

    if (sellerOrder.shipment) {
      throw ApiError.conflict("Shipment already exists")
    }

    if (
  !["CONFIRMED", "PROCESSING"].includes(
    sellerOrder.status
  )
) {
  throw ApiError.badRequest(
    "Seller order is not eligible for shipment"
  );
}

    const shipment = await tx.shipment.create({
      data: {
        sellerOrderId: sellerOrder.id,
        carrierName: data.carrierName,
        trackingNumber: data.trackingNumber,
        trackingUrl: data.trackingUrl,
        status: SHIPPING_STATUS.READY_TO_SHIP,
        estimatedDeliveryAt:
          data.estimatedDeliveryAt,
      },
    });

    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: SHIPPING_STATUS.READY_TO_SHIP,
        description: "Shipment created",
        source: "SELLER",
        actorId: user.id,
      },
    });

    return shipment;
  });
}

const ORDER_STATUS_RANK = {
  PENDING_PAYMENT: 0,
  CONFIRMED: 1,
  PROCESSING: 2,
  SHIPPED: 3,
  DELIVERED: 4,
  REFUNDED: 4,
};

async function syncParentOrderStatus(tx, orderId, changedBy) {
  const [order, sellerOrders] = await Promise.all([
    tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    }),

    tx.sellerOrder.findMany({
      where: { orderId },
      select: { status: true },
    }),
  ]);

  if (!order || sellerOrders.length === 0) return;

  const activeOrders = sellerOrders.filter(
    (item) => item.status !== "CANCELLED"
  );

  let nextStatus;

  if (activeOrders.length === 0) {
    nextStatus = "CANCELLED";
  } else if (
    activeOrders.every((item) => item.status === "REFUNDED")
  ) {
    nextStatus = "REFUNDED";
  } else {
    const lowestRank = Math.min(
      ...activeOrders.map(
        (item) => ORDER_STATUS_RANK[item.status] ?? 0
      )
    );

    nextStatus = Object.keys(ORDER_STATUS_RANK).find(
      (status) => ORDER_STATUS_RANK[status] === lowestRank
    );

    if (
      ORDER_STATUS_RANK[nextStatus] <=
      ORDER_STATUS_RANK[order.status]
    ) {
      return;
    }
  }

  if (nextStatus === order.status) return;

  const result = await tx.order.updateMany({
    where: {
      id: orderId,
      status: order.status,
    },
    data: {
      status: nextStatus,
    },
  });

  if (result.count !== 1) {
    throw ApiError.conflict(
      "Parent order status changed. Please retry."
    );
  }

  await tx.orderStatusHistory.create({
    data: {
      orderId,
      oldStatus: order.status,
      newStatus: nextStatus,
      changedBy,
      note: "Automatically updated based on seller order statuses",
    },
  });
}

async function updateShipmentStatus(user, shipmentId, data) {
  return prisma.$transaction(async (tx) => {
    const seller = await tx.sellerProfile.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!seller) {
      throw ApiError.forbidden("Seller profile required");
    }

    const shipment = await tx.shipment.findFirst({
      where: {
        id: shipmentId,
        sellerOrder: {
          sellerId: seller.id,
        },
      },
      include: {
        sellerOrder: true,
      },
    });

    if (!shipment) {
      throw ApiError.notFound("Shipment not found");
    }

    if (
      !canTransitionShippingStatus(
        shipment.status,
        data.status
      )
    ) {
      throw ApiError.badRequest(
        "Invalid shipment status transition"
      );
    }

    const sellerOrder = shipment.sellerOrder;

    // Order status must also allow the corresponding transition
    if (
      [SHIPPING_STATUS.SHIPPED, SHIPPING_STATUS.DELIVERED].includes(
        data.status
      ) &&
      !canTransitionOrderStatus(sellerOrder.status, data.status)
    ) {
      throw ApiError.badRequest(
        `Seller order cannot change from ${sellerOrder.status} to ${data.status}`
      );
    }

    // Prevent concurrent shipment status updates
    const shipmentUpdate = await tx.shipment.updateMany({
      where: {
        id: shipment.id,
        status: shipment.status,
      },
      data: {
        status: data.status,
        ...(data.status === SHIPPING_STATUS.SHIPPED
          ? { shippedAt: new Date() }
          : {}),
      },
    });

    if (shipmentUpdate.count !== 1) {
      throw ApiError.conflict(
        "Shipment status changed. Please refresh and try again."
      );
    }

    // Save shipment tracking history
    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: data.status,
        description: data.description ?? null,
        source: "SELLER",
        actorId: user.id,
      },
    });

    // Synchronize seller order when shipped or delivered
    if (
      [SHIPPING_STATUS.SHIPPED, SHIPPING_STATUS.DELIVERED].includes(
        data.status
      )
    ) {
      const sellerOrderUpdate = await tx.sellerOrder.updateMany({
        where: {
          id: sellerOrder.id,
          sellerId: seller.id,
          status: sellerOrder.status,
        },
        data: {
          status: data.status,
        },
      });

      if (sellerOrderUpdate.count !== 1) {
        throw ApiError.conflict(
          "Seller order status changed. Please retry."
        );
      }

      // Record seller order status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: sellerOrder.orderId,
          sellerOrderId: sellerOrder.id,
          oldStatus: sellerOrder.status,
          newStatus: data.status,
          changedBy: user.id,
          note: `Shipment status updated to ${data.status}`,
        },
      });

      // Synchronize parent order status
      await syncParentOrderStatus(
        tx,
        sellerOrder.orderId,
        user.id
      );
    }

    return tx.shipment.findUnique({
      where: {
        id: shipment.id,
      },
      include: {
        events: {
          orderBy: {
            createdAt: "asc",
          },
        },
        sellerOrder: true,
      },
    });
  });
}

async function getSellerShipments(user) {
  const seller = await prisma.sellerProfile.findUnique({
    where: {
      userId: user.id,
    },
  });

  if (!seller) {
    throw ApiError.forbidden("Seller profile required");
  }

  return prisma.shipment.findMany({
    where: {
      sellerOrder: {
        sellerId: seller.id,
      },
    },
    include: {
      events: {
        orderBy: {
          createdAt: "asc",
        },
      },
      sellerOrder: {
        include: {
          order: true,
          items: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function getSellerShipmentById(
  user,
  shipmentId
) {
  const seller = await prisma.sellerProfile.findUnique({
    where: {
      userId: user.id,
    },
  });

  if (!seller) {
    throw ApiError.forbidden("Seller profile required");
  }

  const shipment = await prisma.shipment.findFirst({
    where: {
      id: shipmentId,
      sellerOrder: {
        sellerId: seller.id,
      },
    },
    include: {
      events: {
        orderBy: {
          createdAt: "asc",
        },
      },
      sellerOrder: {
        include: {
          order: true,
          items: true,
        },
      },
    },
  });

  if (!shipment) {
    throw ApiError.notFound("Shipment not found");
  }

  return shipment;
}

module.exports = {
  createShipment,
  updateShipmentStatus,
  getSellerShipments,
  getSellerShipmentById,
};
