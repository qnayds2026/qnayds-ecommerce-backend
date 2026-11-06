const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { getApprovedSeller } = require("../../services/ownership.service");
const ApiError = require("../../utils/ApiError");
const { ACTIVE_STATUSES, assertTransition } = require("./return-state");
// Placeholder until the Team Lead confirms the policy.
const RETURN_WINDOW_DAYS = Number(process.env.RETURN_WINDOW_DAYS) || 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function generateReturnNumber() {
  const time = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `RET-${time}-${rand}`;
}

// No deliveredAt column yet, so we read the DELIVERED entry from the status history.
async function getDeliveredAt(tx, sellerOrder) {
  const entry = await tx.orderStatusHistory.findFirst({
    where: {
      orderId: sellerOrder.orderId,
      newStatus: "DELIVERED",
      OR: [{ sellerOrderId: sellerOrder.id }, { sellerOrderId: null }],
    },
    orderBy: { createdAt: "desc" },
  });
  return entry ? entry.createdAt : sellerOrder.updatedAt;
}

async function createReturn(user, body) {
  // 1. Ownership: only the customer's own order.
  const order = await prisma.order.findFirst({
    where: { id: body.orderId, userId: user.id },
    include: { orderItems: true, sellerOrders: true },
  });
  if (!order) throw ApiError.notFound("Order not found");

  // 2. Every requested item must belong to this order.
  const itemsById = new Map(order.orderItems.map((i) => [i.id, i]));
  const selected = body.items.map((reqItem) => {
    const item = itemsById.get(reqItem.orderItemId);
    if (!item) {
      throw ApiError.badRequest(
        `Order item ${reqItem.orderItemId} does not belong to this order`
      );
    }
    return { item, quantity: reqItem.quantity };
  });

  // 3. One return request = one seller order.
  const sellerOrderIds = [...new Set(selected.map((s) => s.item.sellerOrderId))];
  if (sellerOrderIds.length > 1) {
    throw ApiError.badRequest(
      "Items from different sellers must be returned in separate requests"
    );
  }
  const sellerOrder = order.sellerOrders.find((so) => so.id === sellerOrderIds[0]);
  if (!sellerOrder || sellerOrder.status !== "DELIVERED") {
    throw ApiError.badRequest("Only delivered items can be returned");
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // 4. Return window.
        const deliveredAt = await getDeliveredAt(tx, sellerOrder);
        const deadline = new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
        if (new Date() > deadline) {
          throw ApiError.badRequest(
            `Return window of ${RETURN_WINDOW_DAYS} days is over`
          );
        }

        // 5. The order must have a completed payment to refund against.
        const payment = await tx.payment.findFirst({
          where: { orderId: order.id, status: "CAPTURED" },
          orderBy: { capturedAt: "desc" },
        });
        if (!payment) {
          throw ApiError.conflict("No completed payment found for this order");
        }

        // 6. Quantity check: already returned (active) quantities cannot be returned again.
        const already = await tx.returnItem.groupBy({
          by: ["orderItemId"],
          where: {
            orderItemId: { in: selected.map((s) => s.item.id) },
            returnRequest: { status: { in: ACTIVE_STATUSES } },
          },
          _sum: { quantity: true },
        });
        const returnedQty = new Map(
          already.map((r) => [r.orderItemId, r._sum.quantity || 0])
        );

        let refundAmount = new Prisma.Decimal(0);
        const itemRows = selected.map(({ item, quantity }) => {
          const remaining = item.quantity - (returnedQty.get(item.id) || 0);
          if (quantity > remaining) {
            throw ApiError.conflict(
              `Only ${remaining} unit(s) of ${item.productName} can still be returned`
            );
          }
          const lineRefund = new Prisma.Decimal(item.unitPrice).mul(quantity);
          refundAmount = refundAmount.add(lineRefund);
          return {
            orderItemId: item.id,
            quantity,
            unitPrice: item.unitPrice,
            refundAmount: lineRefund,
          };
        });

        // 7. Create return + items + first audit row together.
        return tx.returnRequest.create({
          data: {
            returnNumber: generateReturnNumber(),
            orderId: order.id,
            sellerOrderId: sellerOrder.id,
            userId: user.id,
            status: "REQUESTED",
            reason: body.reason,
            customerNote: body.customerNote || null,
            refundAmount,
            currency: order.currency,
            paymentId: payment.id,
            items: { create: itemRows },
            history: {
              create: {
                oldStatus: null,
                newStatus: "REQUESTED",
                changedBy: user.id,
                actorRole: "CUSTOMER",
                note: body.customerNote || null,
              },
            },
          },
          include: { items: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    // Two requests for the same item at the same moment: one of them must fail.
    if (err.code === "P2034") {
      throw ApiError.conflict("Another return request was processed at the same time, please try again");
    }
    throw err;
  }
}

const returnInclude = {
  items: true,
  history: { orderBy: { createdAt: "asc" } },
};

async function listMyReturns(user, query) {
  const where = { userId: user.id, ...(query.status ? { status: query.status } : {}) };

  const [items, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.returnRequest.count({ where }),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

async function getMyReturn(user, returnId) {
  // Someone else's return looks like a missing one.
  const ret = await prisma.returnRequest.findFirst({
    where: { id: returnId, userId: user.id },
    include: returnInclude,
  });
  if (!ret) throw ApiError.notFound("Return not found");
  return ret;
}

async function cancelReturn(user, returnId, note) {
  return prisma.$transaction(async (tx) => {
    const ret = await tx.returnRequest.findFirst({
      where: { id: returnId, userId: user.id },
    });
    if (!ret) throw ApiError.notFound("Return not found");

    // 409 if the move is not allowed from this status, 403 if the role may not do it.
    assertTransition(ret.status, "CANCELLED", "CUSTOMER");

    // Only update if the status is still what we read (guards against a seller approving at the same time).
    const updated = await tx.returnRequest.updateMany({
      where: { id: ret.id, status: ret.status },
      data: { status: "CANCELLED", closedAt: new Date() },
    });
    if (updated.count === 0) {
      throw ApiError.conflict("Return status changed, please refresh and try again");
    }

    await tx.returnStatusHistory.create({
      data: {
        returnId: ret.id,
        oldStatus: ret.status,
        newStatus: "CANCELLED",
        changedBy: user.id,
        actorRole: "CUSTOMER",
        note: note || null,
      },
    });

    return tx.returnRequest.findUnique({
      where: { id: ret.id },
      include: returnInclude,
    });
  });
}

async function listSellerReturns(user, query) {
  const seller = await getApprovedSeller(user.id);

  // A seller only sees returns for their own seller orders.
  const where = {
    sellerOrder: { sellerId: seller.id },
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.returnRequest.count({ where }),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

// Shared by seller and admin: approve or reject a REQUESTED return.
// A seller can only decide returns of their own seller orders; an admin can decide any.
async function decideReturn(user, returnId, newStatus, note) {
  const role = user.role;
  let sellerId = null;
  if (role === "SELLER") {
    sellerId = (await getApprovedSeller(user.id)).id;
  }

  return prisma.$transaction(async (tx) => {
    const ret = await tx.returnRequest.findFirst({
      where: {
        id: returnId,
        ...(sellerId ? { sellerOrder: { sellerId } } : {}),
      },
    });
    // Another seller's return looks like a missing one.
    if (!ret) throw ApiError.notFound("Return not found");

    // 409 for an invalid move, 403 if this role may not do it.
    assertTransition(ret.status, newStatus, role);

    const updated = await tx.returnRequest.updateMany({
      where: { id: ret.id, status: ret.status },
      data: {
        status: newStatus,
        ...(newStatus === "ITEM_RECEIVED"
            ? { receivedAt: new Date() }
            : { decidedAt: new Date() }),
        [role === "SELLER" ? "sellerNote" : "adminNote"]: note || null,
        ...(newStatus === "REJECTED" ? { closedAt: new Date() } : {}),
        },
    });
    if (updated.count === 0) {
      throw ApiError.conflict("Return status changed, please refresh and try again");
    }

    await tx.returnStatusHistory.create({
      data: {
        returnId: ret.id,
        oldStatus: ret.status,
        newStatus,
        changedBy: user.id,
        actorRole: role,
        note: note || null,
      },
    });

    return tx.returnRequest.findUnique({
      where: { id: ret.id },
      include: returnInclude,
    });
  });
}

const approveReturn = (user, returnId, note) =>
  decideReturn(user, returnId, "APPROVED", note);

const rejectReturn = (user, returnId, note) =>
  decideReturn(user, returnId, "REJECTED", note);

async function listAdminReturns(query) {
  const where = query.status ? { status: query.status } : {};

  const [items, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.returnRequest.count({ where }),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

const markReceived = (user, returnId, note) =>
  decideReturn(user, returnId, "ITEM_RECEIVED", note);

async function addShipment(user, returnId, body) {
  return prisma.$transaction(async (tx) => {
    const ret = await tx.returnRequest.findFirst({
      where: { id: returnId, userId: user.id },
    });
    if (!ret) throw ApiError.notFound("Return not found");

    if (ret.status !== "APPROVED") {
      throw ApiError.conflict("Shipment details can only be added to an approved return");
    }

    const updated = await tx.returnRequest.updateMany({
      where: { id: ret.id, status: "APPROVED" },
      data: {
        carrierName: body.carrierName,
        trackingNumber: body.trackingNumber,
        trackingUrl: body.trackingUrl || null,
      },
    });
    if (updated.count === 0) {
      throw ApiError.conflict("Return status changed, please refresh and try again");
    }

    // Status does not change, but the action is kept in the audit trail.
    await tx.returnStatusHistory.create({
      data: {
        returnId: ret.id,
        oldStatus: "APPROVED",
        newStatus: "APPROVED",
        changedBy: user.id,
        actorRole: "CUSTOMER",
        note: `Return shipment added: ${body.carrierName} ${body.trackingNumber}`,
      },
    });

    return tx.returnRequest.findUnique({
      where: { id: ret.id },
      include: returnInclude,
    });
  });
}

module.exports = {
  createReturn,
  listMyReturns,
  getMyReturn,
  cancelReturn,
  addShipment,
  listSellerReturns,
  listAdminReturns,
  approveReturn,
  rejectReturn,
  markReceived,
};