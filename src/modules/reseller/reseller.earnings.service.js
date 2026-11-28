
const { prisma } = require("../../config/db");
const { Prisma } = require("@prisma/client");
const ApiError = require("../../utils/ApiError");

const earningSelect = {
  id: true,
  orderId: true,
  orderItemId: true,
  quantity: true,
  amount: true,
  status: true,
  eligibleAt: true,
  settlementId: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      currency: true,
      createdAt: true,
    },
  },
  orderItem: {
    select: {
      productName: true,
      variantName: true,
      resellerMargin: true,
      quantity: true,
    },
  },
  events: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      amountDelta: true,
      reason: true,
      createdAt: true,
    },
  },
};

async function getReseller(user, tx = prisma) {
  const profile = await tx.resellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });

  if (!profile) throw ApiError.notFound("Reseller profile not found");

  if (profile.status !== "APPROVED") {
    throw ApiError.forbidden("Your reseller account is not approved");
  }

  return profile;
}

async function getEarningsSummary(user) {
  const reseller = await getReseller(user);

  const rows = await prisma.resellerEarning.groupBy({
    by: ["status"],
    where: { resellerId: reseller.id },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const summary = {
    pending: 0,
    available: 0,
    inSettlement: 0,
    paid: 0,
    cancelled: 0,
    totalRecords: 0,
  };

  for (const row of rows) {
    const amount = Number(row._sum.amount || 0);
    summary.totalRecords += row._count._all;

    if (row.status === "PENDING") summary.pending += amount;
    if (row.status === "ELIGIBLE") summary.available += amount;
    if (row.status === "IN_SETTLEMENT") summary.inSettlement += amount;
    if (row.status === "SETTLED") summary.paid += amount;
    if (row.status === "CANCELLED") summary.cancelled += amount;
  }

  const adjusted = await prisma.resellerEarningEvent.aggregate({
    where: {
      earning: { resellerId: reseller.id },
      type: "ADJUSTED",
    },
    _sum: { amountDelta: true },
  });

  summary.adjusted = Number(adjusted._sum.amountDelta || 0);

  return summary;
}

async function listEarnings(user, query) {
  const reseller = await getReseller(user);

  const where = {
    resellerId: reseller.id,
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.resellerEarning.findMany({
      where,
      select: earningSelect,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.resellerEarning.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

async function listSettlements(user, query) {
  const reseller = await getReseller(user);

  const where = {
    resellerId: reseller.id,
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.resellerSettlement.findMany({
      where,
      select: {
        id: true,
        totalAmount: true,
        currency: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        rejectionReason: true,
        method: true,
        paymentReference: true,
        failureReason: true,
        processedAt: true,
        bankAccount: {
          select: {
            id: true,
            accountHolderName: true,
            accountLast4: true,
            ifsc: true,
            bankName: true,
          },
        },
      },
      orderBy: { requestedAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.resellerSettlement.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

async function getSettlement(user, settlementId) {
  const reseller = await getReseller(user);

  const settlement = await prisma.resellerSettlement.findFirst({
    where: {
      id: settlementId,
      resellerId: reseller.id,
    },
    select: {
      id: true,
      totalAmount: true,
      currency: true,
      status: true,
      requestedAt: true,
      approvedAt: true,
      approvedById: true,
      rejectionReason: true,
      method: true,
      paymentReference: true,
      failureReason: true,
      processedAt: true,
      processedById: true,
      bankAccount: {
        select: {
          id: true,
          accountHolderName: true,
          accountLast4: true,
          ifsc: true,
          bankName: true,
        },
      },
      earnings: {
        select: earningSelect,
      },
    },
  });

  if (!settlement) {
    throw ApiError.notFound("Settlement not found");
  }

  return settlement;
}

async function requestSettlement(user, body, idempotencyKey) {
  const reseller = await getReseller(user);

  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw ApiError.badRequest(
      "A valid Idempotency-Key header is required"
    );
  }

  const existing = await prisma.resellerSettlement.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    if (existing.resellerId !== reseller.id) {
      throw ApiError.conflict("Idempotency key already used");
    }

    return existing;
  }

  return prisma.$transaction(
    async (tx) => {
      const bankWhere = {
        resellerId: reseller.id,
        verificationStatus: "VERIFIED",
        ...(body.bankAccountId
          ? { id: body.bankAccountId }
          : { isPrimary: true }),
      };

      const bankAccount = await tx.resellerBankAccount.findFirst({
        where: bankWhere,
        select: { id: true },
      });

      if (!bankAccount) {
        throw ApiError.badRequest(
          "A verified primary bank account is required"
        );
      }

      const earnings = await tx.resellerEarning.findMany({
        where: {
          resellerId: reseller.id,
          status: "ELIGIBLE",
          order: {
            status: "DELIVERED",
            payments: {
             some: {
              status: "CAPTURED",
              method: "ONLINE",
          },
       },
    },
        },
        select: {
          id: true,
          amount: true,
        },
      });

      if (!earnings.length) {
        throw ApiError.badRequest(
          "No eligible earnings are available for settlement"
        );
      }

      const total = earnings.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0)
      );

      if (total.lte(0)) {
        throw ApiError.badRequest(
          "Settlement amount must be positive"
        );
      }

      const settlement = await tx.resellerSettlement.create({
        data: {
          resellerId: reseller.id,
          bankAccountId: bankAccount.id,
          totalAmount: total.toFixed(2),
          currency: "INR",
          status: "REQUESTED",
          idempotencyKey,
        },
      });

      const changed = await tx.resellerEarning.updateMany({
        where: {
          id: { in: earnings.map((item) => item.id) },
          resellerId: reseller.id,
          status: "ELIGIBLE",
          settlementId: null,
        },
        data: {
          status: "IN_SETTLEMENT",
          settlementId: settlement.id,
        },
      });

      if (changed.count !== earnings.length) {
        throw ApiError.conflict(
          "Earnings changed while requesting settlement"
        );
      }

      return settlement;
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );
}

async function listAdminSettlements(query) {
 const where = {
  ...(query.status ? { status: query.status } : {}),
  ...(query.resellerId ? { resellerId: query.resellerId } : {}),
};

  const [items, total] = await Promise.all([
    prisma.resellerSettlement.findMany({
      where,
      include: {
        reseller: {
          select: {
            id: true,
            displayName: true,
            phone: true,
            user: {
              select: { email: true },
            },
          },
        },
        bankAccount: {
          select: {
            id: true,
            accountHolderName: true,
            accountLast4: true,
            ifsc: true,
            bankName: true,
          },
        },
        _count: {
          select: { earnings: true },
        },
      },
      orderBy: { requestedAt: "asc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.resellerSettlement.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

async function updateAdminSettlement(admin, settlementId, body) {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.resellerSettlement.findUnique({
      where: { id: settlementId },
      include: { earnings: true },
    });

    if (!settlement) {
      throw ApiError.notFound("Settlement not found");
    }

    const allowed = {
      REQUESTED: ["APPROVED", "REJECTED"],
      APPROVED: ["PROCESSING", "REJECTED"],
      PROCESSING: ["PAID", "FAILED"],
      REJECTED: [],
      PAID: [],
      FAILED: [],
    };

    if (!allowed[settlement.status].includes(body.status)) {
      throw ApiError.conflict(
        `Settlement cannot move from ${settlement.status} to ${body.status}`
      );
    }

    if (
      body.status === "PAID" &&
      (!body.paymentReference || !body.method)
    ) {
      throw ApiError.badRequest(
        "paymentReference and method are required to confirm payout"
      );
    }

    if (body.status === "REJECTED" && !body.rejectionReason) {
      throw ApiError.badRequest("rejectionReason is required");
    }

    if (body.status === "FAILED" && !body.failureReason) {
      throw ApiError.badRequest("failureReason is required");
    }

    const updateData = { status: body.status };

    if (body.status === "APPROVED") {
      updateData.approvedAt = new Date();
      updateData.approvedById = admin.id;
    }

    if (body.status === "REJECTED") {
      updateData.rejectionReason = body.rejectionReason;
    }

    if (body.status === "PROCESSING") {
      updateData.method =
        body.method || settlement.method || "BANK_TRANSFER";
    }

    if (body.status === "PAID") {
      updateData.method = body.method;
      updateData.paymentReference = body.paymentReference;
      updateData.processedAt = new Date();
      updateData.processedById = admin.id;
    }

    if (body.status === "FAILED") {
      updateData.failureReason = body.failureReason;
      updateData.processedAt = new Date();
      updateData.processedById = admin.id;
    }

    const updated = await tx.resellerSettlement.updateMany({
      where: {
        id: settlement.id,
        status: settlement.status,
      },
      data: updateData,
    });

    if (updated.count !== 1) {
      throw ApiError.conflict(
        "Settlement changed. Refresh and retry."
      );
    }

    if (["REJECTED", "FAILED"].includes(body.status)) {
      for (const earning of settlement.earnings) {
        if (earning.status !== "IN_SETTLEMENT") continue;

        await tx.resellerEarning.update({
          where: { id: earning.id },
          data: {
            status: "ELIGIBLE",
            settlementId: null,
            events: {
              create: {
                type: "ADJUSTED",
                amountDelta: 0,
                reason: `Settlement ${body.status.toLowerCase()}: ${
                  body.rejectionReason || body.failureReason
                }`,
                actorId: admin.id,
              },
            },
          },
        });
      }
    }

    if (body.status === "PAID") {
      for (const earning of settlement.earnings) {
        if (earning.status !== "IN_SETTLEMENT") {
          throw ApiError.conflict(
            "Settlement contains an earning that is not in settlement"
          );
        }

        await tx.resellerEarning.update({
          where: { id: earning.id },
          data: {
            status: "SETTLED",
            events: {
              create: {
                type: "SETTLED",
                amountDelta: earning.amount,
                reason: `Settlement paid: ${body.paymentReference}`,
                actorId: admin.id,
              },
            },
          },
        });
      }
    }

    return tx.resellerSettlement.findUnique({
      where: { id: settlement.id },
      include: {
        bankAccount: {
          select: {
            id: true,
            accountHolderName: true,
            accountLast4: true,
            ifsc: true,
            bankName: true,
          },
        },
        earnings: {
          select: {
            id: true,
            amount: true,
            status: true,
            orderId: true,
          },
        },
      },
    });
  });
}

module.exports = {
  getEarningsSummary,
  listEarnings,
  listSettlements,
  getSettlement,
  requestSettlement,
  listAdminSettlements,
  updateAdminSettlement,
};
