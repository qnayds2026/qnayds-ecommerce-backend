const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");
const { getSellerByUser } = require("./ownership.service");
const { canTransitionOrderStatus } = require("../modules/orders/order-status");
const { validateCartForCheckout } = require("./cart.service");

function generateOrderNumber() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `QO-${timestamp}-${random}`;
}

// Seller-inte swantham orders maathram list cheyyuka
async function listSellerOrders(user, page = 1, limit = 10) {
  const seller = await getSellerByUser(user.id);

  if (!seller) {
    throw ApiError.forbidden("Seller profile required");
  }

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    prisma.sellerOrder.findMany({
      where: {
        sellerId: seller.id,
      },
      include: {
        order: true,
        items: true,
        shipment: true,
        statusHistory: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),

    prisma.sellerOrder.count({
      where: {
        sellerId: seller.id,
      },
    }),
  ]);

  return {
    orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
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
  } else if (activeOrders.every((item) => item.status === "REFUNDED")) {
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

    // Never move the parent order backwards
    if (
      ORDER_STATUS_RANK[nextStatus] <=
      ORDER_STATUS_RANK[order.status]
    ) {
      return;
    }
  }

  if (nextStatus === order.status) return;

  const updated = await tx.order.updateMany({
    where: {
      id: orderId,
      status: order.status,
    },
    data: {
      status: nextStatus,
    },
  });

  if (updated.count !== 1) {
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

// Seller-inte swantham order details maathram
async function getSellerOrderById(user, orderId) {
  const seller = await getSellerByUser(user.id);

  if (!seller) {
    throw ApiError.forbidden("Seller profile required");
  }

  const sellerOrder = await prisma.sellerOrder.findFirst({
    where: {
      id: orderId,
      sellerId: seller.id,
    },
    include: {
      order: true,
      items: true,
      shipment: true,
      statusHistory: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!sellerOrder) {
    throw ApiError.notFound("Seller order not found");
  }

  return sellerOrder;
}

// Seller-inte swantham order status update cheyyuka
async function updateSellerOrderStatus(user, orderId, body) {
  const seller = await getSellerByUser(user.id);

  if (!seller) {
    throw ApiError.forbidden("Seller profile required");
  }

  const sellerOrder = await prisma.sellerOrder.findFirst({
    where: {
      id: orderId,
      sellerId: seller.id,
    },
  });

    if (!sellerOrder) {
    throw ApiError.notFound("Seller order not found");
  }

  if (body.status === "SHIPPED") {
    throw ApiError.badRequest(
      "Use the shipment endpoint to mark an order as shipped"
    );
  }

  const isAllowed = canTransitionOrderStatus(
    sellerOrder.status,
    body.status
  );

  if (!isAllowed) {
    throw ApiError.badRequest(
      `Invalid status transition from ${sellerOrder.status} to ${body.status}`
    );
  }

  return prisma.$transaction(async (tx) => {
    // Prevent concurrent status updates
    const result = await tx.sellerOrder.updateMany({
      where: {
        id: sellerOrder.id,
        sellerId: seller.id,
        status: sellerOrder.status,
      },
      data: {
        status: body.status,
      },
    });

    if (result.count !== 1) {
      throw ApiError.conflict(
        "Order status was changed by another request. Please refresh and try again."
      );
    }

    // Record status history
       await tx.orderStatusHistory.create({
      data: {
        orderId: sellerOrder.orderId,
        sellerOrderId: sellerOrder.id,
        oldStatus: sellerOrder.status,
        newStatus: body.status,
        changedBy: user.id,
        note: body.note ?? null,
      },
    });

    // Synchronize parent customer order status
    await syncParentOrderStatus(
      tx,
      sellerOrder.orderId,
      user.id
    );

    return tx.sellerOrder.findUnique({
      where: {
        id: sellerOrder.id,
      },
    });
  });
}

// Seller shipment details add cheyyuka
async function createSellerShipment(user, orderId, body) {
  const seller = await getSellerByUser(user.id);

  if (!seller) {
    throw ApiError.forbidden("Seller profile required");
  }

  const sellerOrder = await prisma.sellerOrder.findFirst({
    where: {
      id: orderId,
      sellerId: seller.id,
    },
  });

  if (!sellerOrder) {
    throw ApiError.notFound("Seller order not found");
  }

  if (!canTransitionOrderStatus(sellerOrder.status, "SHIPPED")) {
    throw ApiError.badRequest(
      "Order cannot be shipped from its current status"
    );
  }

  return prisma.$transaction(async (tx) => {
    // Verify status has not changed concurrently
    const result = await tx.sellerOrder.updateMany({
      where: {
        id: sellerOrder.id,
        sellerId: seller.id,
        status: sellerOrder.status,
      },
      data: {
        status: "SHIPPED",
      },
    });

    if (result.count !== 1) {
      throw ApiError.conflict(
        "Order status changed. Please refresh and try again."
      );
    }

    // Create shipment inside the same transaction
    const shipment = await tx.shipment.create({
      data: {
        sellerOrderId: sellerOrder.id,
        carrierName: body.carrierName,
        trackingNumber: body.trackingNumber,
        trackingUrl: body.trackingUrl ?? null,
      },
    });

    // Record status history
    await tx.orderStatusHistory.create({
      data: {
        orderId: sellerOrder.orderId,
        sellerOrderId: sellerOrder.id,
        oldStatus: sellerOrder.status,
        newStatus: "SHIPPED",
        changedBy: user.id,
        note: "Shipment created",
      },
    });
    await syncParentOrderStatus(
      tx,
      sellerOrder.orderId,
      user.id
    );
    return shipment;
  });
}
// Customer-inte own orders list cheyyuka
async function listCustomerOrders(user, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: {
        userId: user.id,
      },
      include: {
        sellerOrders: {
          include: {
            items: true,
            shipment: true,
            statusHistory: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
        orderItems: true,
        orderStatusHistories: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),
    prisma.order.count({
      where: {
        userId: user.id,
      },
    }),
  ]);

  return {
    orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// Customer-inte own order details maathram
async function getCustomerOrderById(user, orderId) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId: user.id,
    },
    include: {
      sellerOrders: {
        include: {
          items: true,
          shipment: true,
          statusHistory: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
      orderItems: true,
      orderStatusHistories: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  return order;
}

async function getCustomerOrderTracking(user, orderId) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId: user.id,
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      sellerOrders: {
        select: {
          id: true,
          status: true,
          shipment: true,
          statusHistory: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
      orderStatusHistories: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  return order;
}


async function createOrder(user, body = {}, idempotencyKey) {
  if (
  typeof idempotencyKey !== "string" ||
  !idempotencyKey.trim()
) {
  throw ApiError.badRequest("Idempotency-Key header is required");
}

const normalizedIdempotencyKey = idempotencyKey.trim();

if (normalizedIdempotencyKey.length > 100) {
  throw ApiError.badRequest(
    "Idempotency-Key must not exceed 100 characters"
  );
}

  // Same request retry cheythal existing order return cheyyuka
  const existingOrder = await prisma.order.findFirst({
    where: {
      userId: user.id,
      idempotencyKey: normalizedIdempotencyKey,
    },
    include: {
      sellerOrders: { include: { items: true, shipment: true } },
      orderItems: true,
    },
  });

  if (existingOrder) return existingOrder;

  try {
    return await prisma.$transaction(async (tx) => {
      // Cart validation
      await validateCartForCheckout(user.id, tx);

      const cart = await tx.cart.findUnique({
        where: { userId: user.id },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                  inventory: true,
                },
              },
            },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        throw ApiError.badRequest("Cart is empty");
      }

      // Customer address ownership validation
      const address = body.addressId
        ? await tx.address.findFirst({
            where: { id: body.addressId, userId: user.id },
          })
        : await tx.address.findFirst({
            where: { userId: user.id, isDefault: true },
          });

      if (!address) {
        throw ApiError.badRequest("Valid delivery address not found");
      }

      const sellerGroups = new Map();
      let grandTotal = new Prisma.Decimal(0);

      for (const cartItem of cart.items) {
        const variant = cartItem.variant;
        const product = variant.product;
        const quantity = cartItem.quantity;

        if (
          !variant.isActive ||
          product.status !== "ACTIVE" ||
          !variant.inventory
        ) {
          throw ApiError.conflict(
            `Product is unavailable: ${product.name}`
          );
        }

        const available =
          variant.inventory.quantityAvailable -
          variant.inventory.quantityReserved;

        if (available < quantity) {
          throw ApiError.conflict(
            `Insufficient stock for ${product.name}`
          );
        }

        // Current DB price use cheyyuka; client price trust cheyyaruthu
        const unitPrice = new Prisma.Decimal(variant.price.toString());
        const subtotal = unitPrice.mul(quantity);

        grandTotal = grandTotal.plus(subtotal);

        const sellerId = product.sellerId;

        if (!sellerGroups.has(sellerId)) {
          sellerGroups.set(sellerId, {
            totalAmount: new Prisma.Decimal(0),
            items: [],
          });
        }

        const group = sellerGroups.get(sellerId);
        group.totalAmount = group.totalAmount.plus(subtotal);

        group.items.push({
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          variantAttributes: variant.attributes ?? null,
          sku: variant.sku,
          unitPrice,
          quantity,
          subtotal,
        });
      }

      // Parent customer order
      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: user.id,
          idempotencyKey: normalizedIdempotencyKey,
          status: "PENDING_PAYMENT",
          totalAmount: grandTotal,
          currency: "INR",

          deliveryName: address.recipientName,
          deliveryPhone: address.phone,
          deliveryAddressLine1: address.addressLine1,
          deliveryAddressLine2: address.addressLine2,
          deliveryCity: address.city,
          deliveryState: address.state,
          deliveryPostalCode: address.postalCode,
          deliveryCountry: address.country,
        },
      });

      // Seller-specific orders and immutable item snapshots
      for (const [sellerId, group] of sellerGroups) {
        const sellerOrder = await tx.sellerOrder.create({
          data: {
            orderId: order.id,
            sellerId,
            status: "PENDING_PAYMENT",
            totalAmount: group.totalAmount,
          },
        });

        for (const item of group.items) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              sellerOrderId: sellerOrder.id,
              ...item,
            },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            sellerOrderId: sellerOrder.id,
            oldStatus: null,
            newStatus: "PENDING_PAYMENT",
            changedBy: user.id,
            note: "Order created",
          },
        });
      }

      // Overall order status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          oldStatus: null,
          newStatus: "PENDING_PAYMENT",
          changedBy: user.id,
          note: "Order created",
        },
      });

      // Atomically reserve stock; quantityAvailable stays unchanged
      for (const cartItem of cart.items) {
        const quantity = cartItem.quantity;
        const variantId = cartItem.variantId;

        const reserved = await tx.$executeRaw`
          UPDATE "inventory"
          SET "quantityReserved" = "quantityReserved" + ${quantity},
              "updatedAt" = NOW()
          WHERE "variantId" = ${variantId}
            AND ("quantityAvailable" - "quantityReserved") >= ${quantity}
        `;

        if (reserved !== 1) {
          throw ApiError.conflict(
            `Stock changed while placing order for ${cartItem.variant.product.name}`
          );
        }
      }

      // Clear cart only after successful order creation
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      return tx.order.findUnique({
        where: { id: order.id },
        include: {
          sellerOrders: {
            include: {
              items: true,
              shipment: true,
            },
          },
          orderItems: true,
          orderStatusHistories: {
            orderBy: { createdAt: "desc" },
          },
        },
      });
    });
  } catch (error) {
    // Concurrent duplicate request: return the already-created order
    if (error.code === "P2002") {
      const duplicate = await prisma.order.findFirst({
        where: {
          userId: user.id,
          idempotencyKey: normalizedIdempotencyKey,
        },
        include: {
          sellerOrders: { include: { items: true, shipment: true } },
          orderItems: true,
        },
      });

      if (duplicate) return duplicate;
    }

    throw error;
  }
}

// Admin: list ALL customer orders with pagination, status filter and search.
// Search matches order number, customer name or customer email.
// Customer details are loaded with a separate query (no relation name needed).
async function adminListOrders({ page = 1, limit = 10, status, search }) {
  const skip = (page - 1) * limit;

  const where = {};
  if (status) where.status = status;

  if (search) {
    const matchedUsers = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });

    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { userId: { in: matchedUsers.map((u) => u.id) } },
    ];
  }

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        status: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        orderItems: { select: { id: true, quantity: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  const userIds = [...new Set(orders.map((o) => o.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    orders: orders.map((o) => ({
      ...o,
      customer: userMap.get(o.userId) || null,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
async function cancelCustomerOrder(user, orderId, body) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        userId: user.id,
      },
      include: {
        sellerOrders: true,
        orderItems: true,
      },
    });

    if (!order) {
      throw ApiError.notFound("Order not found");
    }

    if (!canTransitionOrderStatus(order.status, "CANCELLED")) {
      throw ApiError.badRequest(
        `Order cannot be cancelled from ${order.status}`
      );
    }

    // Skip seller orders that are already cancelled
    const activeSellerOrders = order.sellerOrders.filter(
      (sellerOrder) => sellerOrder.status !== "CANCELLED"
    );

    if (activeSellerOrders.length === 0) {
      throw ApiError.badRequest("All seller orders are already cancelled");
    }

    // Validate cancellation transition for active seller orders
    for (const sellerOrder of activeSellerOrders) {
      if (!canTransitionOrderStatus(sellerOrder.status, "CANCELLED")) {
        throw ApiError.badRequest(
          `Seller order cannot be cancelled from ${sellerOrder.status}`
        );
      }
    }

    // Conditionally cancel the parent order
    const orderUpdate = await tx.order.updateMany({
      where: {
        id: order.id,
        userId: user.id,
        status: order.status,
      },
      data: {
        status: "CANCELLED",
      },
    });

    if (orderUpdate.count !== 1) {
      throw ApiError.conflict(
        "Order status changed. Please refresh and try again."
      );
    }

    // Cancel only active seller orders
    for (const sellerOrder of activeSellerOrders) {
      const sellerUpdate = await tx.sellerOrder.updateMany({
        where: {
          id: sellerOrder.id,
          orderId: order.id,
          status: sellerOrder.status,
        },
        data: {
          status: "CANCELLED",
        },
      });

      if (sellerUpdate.count !== 1) {
        throw ApiError.conflict(
          "Seller order status changed. Please refresh and try again."
        );
      }
    }

    // Collect items belonging only to active seller orders
    const activeSellerOrderIds = new Set(
      activeSellerOrders.map((sellerOrder) => sellerOrder.id)
    );

    const activeOrderItems = order.orderItems.filter((item) =>
      activeSellerOrderIds.has(item.sellerOrderId)
    );

    // Group quantities by variant
    const quantitiesByVariant = new Map();

    for (const item of activeOrderItems) {
      const currentQuantity =
        quantitiesByVariant.get(item.variantId) || 0;

      quantitiesByVariant.set(
        item.variantId,
        currentQuantity + item.quantity
      );
    }

    // Release reserved stock only for active seller orders
    for (const [variantId, quantity] of quantitiesByVariant) {
      const released = await tx.$executeRaw`
        UPDATE "inventory"
        SET "quantityReserved" = "quantityReserved" - ${quantity},
            "updatedAt" = NOW()
        WHERE "variantId" = ${variantId}
          AND "quantityReserved" >= ${quantity}
      `;

      if (released !== 1) {
        throw ApiError.conflict(
          "Unable to release reserved stock. Please contact support."
        );
      }
    }

    // Parent order status history
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        oldStatus: order.status,
        newStatus: "CANCELLED",
        changedBy: user.id,
        note: body.reason,
      },
    });

    // Status history for active seller orders only
    for (const sellerOrder of activeSellerOrders) {
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          sellerOrderId: sellerOrder.id,
          oldStatus: sellerOrder.status,
          newStatus: "CANCELLED",
          changedBy: user.id,
          note: body.reason,
        },
      });
    }

    return tx.order.findUnique({
      where: { id: order.id },
      include: {
        sellerOrders: {
          include: {
            items: true,
            shipment: true,
          },
        },
        orderItems: true,
        orderStatusHistories: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });
}


module.exports = {
  createOrder,
  listSellerOrders,
  getSellerOrderById,
  updateSellerOrderStatus,
  createSellerShipment,
  listCustomerOrders,
  getCustomerOrderById,
  getCustomerOrderTracking,
  cancelCustomerOrder,
  adminListOrders,
};