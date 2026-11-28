const { Prisma } = require("@prisma/client");

async function adjustEarningsForReturn(tx, returnId, actorId) {
  // Compatibility guard for transactions that do not expose this model.
  if (typeof tx?.returnRequest?.findUnique !== "function") return;

  const ret = await tx.returnRequest.findUnique({
    where: { id: returnId },
    include: {
      items: {
        include: {
          orderItem: {
            include: {
              resellerEarning: true,
            },
          },
        },
      },
    },
  });

  if (!ret || !Array.isArray(ret.items)) return;

  for (const returnItem of ret.items) {
    const orderItem = returnItem.orderItem;
    const earning = orderItem?.resellerEarning;

    if (!earning || orderItem.resellerMargin == null) continue;

    const reason = `RETURN_REFUND:${ret.id}:${returnItem.id}`;

    const existing = await tx.resellerEarningEvent.findFirst({
      where: {
        earningId: earning.id,
        type: "ADJUSTED",
        reason,
      },
      select: { id: true },
    });

    if (existing) continue;

    if (["IN_SETTLEMENT", "SETTLED"].includes(earning.status)) {
      console.error(
        `[reseller-earnings] Manual reconciliation required for earning ${earning.id}, return ${ret.id}`
      );
      continue;
    }

    if (!["PENDING", "ELIGIBLE"].includes(earning.status)) continue;

    const quantity = Number(returnItem.quantity);
    const currentQuantity = Number(earning.quantity);

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > currentQuantity
    ) {
      throw new Error(`Invalid returned quantity for earning ${earning.id}`);
    }

    const adjustment = new Prisma.Decimal(orderItem.resellerMargin).mul(quantity);
    const remainingAmount = new Prisma.Decimal(earning.amount).sub(adjustment);

    if (remainingAmount.lt(0)) {
      throw new Error(`Earning adjustment exceeds balance for ${earning.id}`);
    }

    const remainingQuantity = currentQuantity - quantity;

    const changed = await tx.resellerEarning.updateMany({
      where: {
        id: earning.id,
        quantity: earning.quantity,
        amount: earning.amount,
        status: earning.status,
      },
      data: {
        quantity: remainingQuantity,
        amount: remainingAmount,
        status: remainingQuantity === 0 ? "CANCELLED" : earning.status,
      },
    });

    if (changed.count !== 1) {
      throw new Error(`Earning changed concurrently: ${earning.id}`);
    }

    await tx.resellerEarningEvent.create({
      data: {
        earningId: earning.id,
        type: "ADJUSTED",
        amountDelta: adjustment.negated(),
        reason,
        actorId: actorId || "system",
      },
    });
  }
}

module.exports = { adjustEarningsForReturn };