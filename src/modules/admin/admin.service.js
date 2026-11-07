const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");

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

module.exports = {
  getDashboardSummary,
  listCustomers,
  listAdminProducts,
  listAdminOrders,
  getAdminOrderDetails,
  updateProductStatus,
  updateCustomerStatus,
  getSalesReport,
};