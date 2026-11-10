const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");
const {
  canTransitionShippingStatus,
  SHIPPING_STATUS,
} = require("../shipping/shipping-status");

const {
  canTransitionOrderStatus,
} = require("../orders/order-status");

async function getDashboardSummary(query = {}) {
  const { startDate, endDate } = query;

  const dateFilter = {
    ...(startDate && {
      gte: new Date(startDate),
    }),
    ...(endDate && {
      lte: new Date(endDate),
    }),
  };

  const orderWhere = Object.keys(dateFilter).length
    ? { createdAt: dateFilter }
    : {};

  const orderValueWhere = {
    ...orderWhere,
    status: {
      notIn: ["CANCELLED", "REFUNDED"],
    },
  };

  const [
    totalCustomers,
    activeSellers,
    pendingSellerApplications,
    activeProducts,
    totalOrders,
    orderValue,
    recentOrders,
  ] = await Promise.all([
    prisma.user.count({
      where: { role: "CUSTOMER" },
    }),

    prisma.sellerProfile.count({
      where: { status: "APPROVED" },
    }),

    prisma.sellerProfile.count({
      where: { status: "PENDING" },
    }),

    prisma.product.count({
      where: { status: "ACTIVE" },
    }),

    prisma.order.count({
      where: orderWhere,
    }),

    prisma.order.aggregate({
      where: orderValueWhere,
      _sum: {
        totalAmount: true,
      },
    }),

    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),
  ]);

  return {
    metrics: {
      totalCustomers,
      activeSellers,
      pendingSellerApplications,
      activeProducts,
      totalOrders,
      orderValue: orderValue._sum.totalAmount || 0,
    },
    recentOrders,
  };
}

async function listCustomers(query) {
  const { page, limit, search } = query;

  const where = {
    role: "CUSTOMER",
    ...(search && {
      OR: [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
      ],
    }),
  };

  const [customers, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.user.count({ where }),
  ]);

  return {
    customers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function listAdminOrders(query) {
  const {
    page,
    limit,
    search,
    status,
    customerId,
    sellerId,
    startDate,
    endDate,
  } = query;

  const where = {
    ...(status && { status }),
    ...(customerId && { userId: customerId }),

    ...(sellerId && {
      sellerOrders: {
        some: {
          sellerId,
        },
      },
    }),

    ...(search && {
      OR: [
        {
          orderNumber: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          user: {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          user: {
            email: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
      ],
    }),

    ...((startDate || endDate) && {
      createdAt: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      },
    }),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        sellerOrders: {
          include: {
            seller: {
              select: {
                id: true,
                shopName: true,
              },
            },
            items: true,
            shipment: true,
            statusHistory: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        },
        orderItems: true,
        orderStatusHistories: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.order.count({ where }),
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

async function getAdminOrderDetails(orderId) {
  const order = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      sellerOrders: {
        include: {
          seller: {
            select: {
              id: true,
              shopName: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          items: true,
          shipment: true,
          statusHistory: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      },
      orderItems: true,
      orderStatusHistories: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  return order;
}

async function listAdminProducts(query) {
  const { page, limit, status, categoryId, sellerId, search } = query;

  const where = {
    ...(status && { status }),
    ...(categoryId && { categoryId }),
    ...(sellerId && { sellerId }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        seller: {
          select: {
            id: true,
            shopName: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        images: {
          orderBy: { sortOrder: "asc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}


async function updateProductStatus(id, status, adminId, reason) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      seller: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const allowedTransitions = {
    DRAFT: ["ACTIVE", "REJECTED", "ARCHIVED"],
    ACTIVE: ["ARCHIVED"],
    REJECTED: ["DRAFT", "ARCHIVED"],
    ARCHIVED: ["ACTIVE"],
  };

  if (!allowedTransitions[product.status]?.includes(status)) {
    throw ApiError.badRequest(
      `Cannot change product status from ${product.status} to ${status}`
    );
  }

  if (status === "ACTIVE" && product.seller.status !== "APPROVED") {
    throw ApiError.badRequest(
      "Only products belonging to approved sellers can be activated"
    );
  }

  if (status === "REJECTED" && !reason) {
    throw ApiError.badRequest(
      "Rejection reason is required"
    );
  }

  return prisma.$transaction(async (tx) => {
    const updatedProduct = await tx.product.update({
      where: { id },
      data: { status },
    });

    await tx.productStatusHistory.create({
      data: {
        productId: id,
        adminId,
        fromStatus: product.status,
        toStatus: status,
        reason: reason || null,
      },
    });

    return updatedProduct;
  });
}

async function updateCustomerStatus(id, status, adminId, reason) {
  const customer = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  });

  if (!customer) {
    throw ApiError.notFound("Customer not found");
  }

  if (customer.role !== "CUSTOMER") {
    throw ApiError.badRequest("User is not a customer");
  }

  const allowedTransitions = {
    ACTIVE: ["BLOCKED"],
    BLOCKED: ["ACTIVE"],
  };

  if (!allowedTransitions[customer.status]?.includes(status)) {
    throw ApiError.badRequest(
      `Cannot change customer status from ${customer.status} to ${status}`
    );
  }

  if (status === "BLOCKED" && !reason?.trim()) {
    throw ApiError.badRequest("Reason is required to block a customer");
  }

  return prisma.$transaction(async (tx) => {
    const updatedCustomer = await tx.user.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });

    await tx.customerStatusHistory.create({
      data: {
        customerId: id,
        adminId,
        fromStatus: customer.status,
        toStatus: status,
        reason: reason?.trim() || null,
      },
    });

    return updatedCustomer;
  });
}

async function getSalesReport(query = {}) {
  const { startDate, endDate } = query;

  const dateFilter = {
    ...(startDate && { gte: new Date(startDate) }),
    ...(endDate && { lte: new Date(endDate) }),
  };

  const where = Object.keys(dateFilter).length
    ? { createdAt: dateFilter }
    : {};

  const [totalOrders, orderValue, statusSummary, dailyOrders] =
    await Promise.all([
      prisma.order.count({
        where,
      }),

      prisma.order.aggregate({
        where: {
          ...where,
          status: {
            notIn: ["CANCELLED", "REFUNDED"],
          },
        },
        _sum: {
          totalAmount: true,
        },
      }),

      prisma.order.groupBy({
        by: ["status"],
        where,
        _count: {
          _all: true,
        },
        orderBy: {
          status: "asc",
        },
      }),

      prisma.order.findMany({
        where,
        select: {
          createdAt: true,
          totalAmount: true,
          status: true,
          currency: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
    ]);

  return {
    summary: {
      totalOrders,
      orderValue: orderValue._sum.totalAmount || 0,
      orderValueDescription:
        "Sum of non-cancelled and non-refunded order amounts. This is not verified sales revenue.",
    },
    statusSummary: statusSummary.map((item) => ({
      status: item.status,
      count: item._count._all,
    })),
    dailyOrders,
  };
}


async function listAdminShipments(query = {}) {
  const page = query.page || 1;
  const limit = query.limit || 20;

  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            {
              trackingNumber: {
                contains: query.search,
                mode: "insensitive",
              },
            },
            {
              carrierName: {
                contains: query.search,
                mode: "insensitive",
              },
            },
            {
              sellerOrder: {
                order: {
                  orderNumber: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, shipments] = await Promise.all([
    prisma.shipment.count({ where }),

    prisma.shipment.findMany({
      where,
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
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    shipments,
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

async function syncAdminParentOrderStatus(tx, orderId, changedBy) {
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
      note: "Automatically updated by admin shipment management",
    },
  });
}

async function updateAdminShipmentStatus(
  admin,
  shipmentId,
  data
) {
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({
      where: {
        id: shipmentId,
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

    if (
      [SHIPPING_STATUS.SHIPPED, SHIPPING_STATUS.DELIVERED].includes(
        data.status
      ) &&
      !canTransitionOrderStatus(
        sellerOrder.status,
        data.status
      )
    ) {
      throw ApiError.badRequest(
        `Seller order cannot change from ${sellerOrder.status} to ${data.status}`
      );
    }

    const updated = await tx.shipment.updateMany({
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

    if (updated.count !== 1) {
      throw ApiError.conflict(
        "Shipment status changed. Please refresh and try again."
      );
    }

    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: data.status,
        description: data.description ?? null,
        source: "ADMIN",
        actorId: admin.id,
      },
    });

    if (
      [SHIPPING_STATUS.SHIPPED, SHIPPING_STATUS.DELIVERED].includes(
        data.status
      )
    ) {
      const sellerOrderUpdate = await tx.sellerOrder.updateMany({
        where: {
          id: sellerOrder.id,
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

      await tx.orderStatusHistory.create({
        data: {
          orderId: sellerOrder.orderId,
          sellerOrderId: sellerOrder.id,
          oldStatus: sellerOrder.status,
          newStatus: data.status,
          changedBy: admin.id,
          note: `Admin updated shipment status to ${data.status}`,
        },
      });

      await syncAdminParentOrderStatus(
        tx,
        sellerOrder.orderId,
        admin.id
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
        sellerOrder: {
          include: {
            order: true,
            items: true,
          },
        },
      },
    });
  });
}


module.exports = {
  getDashboardSummary,
  listCustomers,
  listAdminProducts,
  listAdminOrders,
  getAdminOrderDetails,
  updateProductStatus,
  updateCustomerStatus,
  getSalesReport,
  listAdminShipments,
  updateAdminShipmentStatus,
};