const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");
const razorpay = require("../payments/razorpay.service");
const { assertTransition } = require("./return-state");
const {
  createManyNotifications,
} = require("../notifications/notifications.service");
const returnInclude = {
  items: true,
  history: { orderBy: { createdAt: "asc" } },
};

// A second refund call for these returns just returns the current record.
const ALREADY_STARTED = ["REFUND_INITIATED", "REFUNDED", "CLOSED"];

// A REFUND_INITIATED return without a saved refund is "stalled" after this long
// (the server stopped or Razorpay did not answer). Calling refund again then resumes it.
const STALLED_AFTER_MS = 2 * 60 * 1000;

function gatewayMessage(err) {
  const msg = (err && err.error && err.error.description) || (err && err.message) || "Unknown error";
  return String(msg).slice(0, 200);
}

// Razorpay answered with a 4xx: the refund was NOT created, so it is safe to mark it failed.
// Anything else (timeout, network error, 5xx) means we do not know, and a refund may exist.
function isDefiniteRejection(err) {
  const code = err && err.statusCode;
  return Number.isInteger(code) && code >= 400 && code < 500;
}

async function markRefundFailed(returnId, message) {
  const failedReturn = await prisma.$transaction(async (tx) => {
    const updated = await tx.returnRequest.updateMany({
      where: { id: returnId, status: "REFUND_INITIATED" },
      data: { status: "REFUND_FAILED", refundIdempotencyKey: null },
    });

    if (updated.count === 0) return null;

    await tx.returnStatusHistory.create({
      data: {
        returnId,
        oldStatus: "REFUND_INITIATED",
        newStatus: "REFUND_FAILED",
        changedBy: "system",
        actorRole: "SYSTEM",
        note: `Refund request failed: ${message}`,
      },
    });

    return tx.returnRequest.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        returnNumber: true,
      },
    });
  });

  if (!failedReturn) return;

  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    await createManyNotifications(
      admins.map((admin) => ({
        userId: admin.id,
        type: "REFUND_FAILED",
        title: "Refund failed",
        message: `Refund for return ${failedReturn.returnNumber} failed: ${message}`,
        link: `/admin/returns/${failedReturn.id}`,
        dedupeKey: `REFUND_FAILED:${failedReturn.id}:${admin.id}`,
      }))
    );
  } catch (error) {
    console.error(
      "[notifications] Admin refund failure notification failed:",
      error.message
    );
  }
}
async function refundReturn(user, returnId, note) {
  // Fail before anything is changed if Razorpay is not configured.
  razorpay.assertConfigured();

  // Phase 1: check everything and claim the refund inside one transaction.
  const claim = await prisma.$transaction(async (tx) => {
    const ret = await tx.returnRequest.findUnique({
      where: { id: returnId },
      include: { payment: true },
    });
    if (!ret) throw ApiError.notFound("Return not found");

    const resuming =
      ret.status === "REFUND_INITIATED" &&
      !ret.paymentRefundId &&
      Date.now() - ret.updatedAt.getTime() > STALLED_AFTER_MS;

    if (!resuming && ALREADY_STARTED.includes(ret.status)) return { done: true };

    // 409 if the move is not allowed from this status (for example not ITEM_RECEIVED yet).
    if (!resuming) assertTransition(ret.status, "REFUND_INITIATED", "ADMIN");

    const payment = ret.payment;
    if (!payment || payment.method !== "ONLINE" || !payment.gatewayPaymentId) {
      throw ApiError.conflict("This order was not paid online, so it needs a manual refund");
    }
    if (!["CAPTURED", "REFUND_PENDING"].includes(payment.status)) {
      throw ApiError.conflict("Payment is not in a refundable state");
    }

    // Never refund more than the payment amount in total (checked when the refund is first claimed).
    if (!resuming) {
      const sums = await tx.paymentRefund.aggregate({
        where: { paymentId: payment.id, status: { in: ["PENDING", "PROCESSED"] } },
        _sum: { amount: true },
      });
      const alreadyRefunded = sums._sum.amount || new Prisma.Decimal(0);
      if (alreadyRefunded.add(ret.refundAmount).gt(payment.amount)) {
        throw ApiError.conflict("Refund amount is more than what is left on the payment");
      }
    }

    // Only one caller can win this update. The status (and for a resume, updatedAt) is checked in the same statement.
    const claimed = await tx.returnRequest.updateMany({
      where: resuming
        ? { id: ret.id, status: "REFUND_INITIATED", paymentRefundId: null, updatedAt: ret.updatedAt }
        : { id: ret.id, status: ret.status },
      data: {
        status: "REFUND_INITIATED",
        refundIdempotencyKey: `${ret.returnNumber}:${crypto.randomUUID()}`,
        ...(note ? { adminNote: note } : {}),
      },
    });
    if (claimed.count === 0) {
      const current = await tx.returnRequest.findUnique({ where: { id: ret.id } });
      if (current && ALREADY_STARTED.includes(current.status)) return { done: true };
      throw ApiError.conflict("Return status changed, please refresh and try again");
    }

    await tx.returnStatusHistory.create({
      data: {
        returnId: ret.id,
        oldStatus: ret.status,
        newStatus: "REFUND_INITIATED",
        changedBy: user.id,
        actorRole: "ADMIN",
        note: resuming
          ? `Refund resumed after a stalled attempt${note ? `: ${note}` : ""}`
          : note || null,
      },
    });

    return { done: false, ret, payment };
  });

  if (claim.done) {
    return prisma.returnRequest.findUnique({ where: { id: returnId }, include: returnInclude });
  }

  const { ret, payment } = claim;
  const amountPaise = razorpay.toPaise(ret.refundAmount);

  // Phase 2: call Razorpay outside the transaction.
  // First look for a refund of this return that already exists at Razorpay (a timed-out
  // earlier attempt may have created it) and reuse it, so one return can never be refunded twice.
  let gatewayRefund;
  try {
    gatewayRefund = await razorpay.findGatewayRefundForReturn(payment.gatewayPaymentId, ret.id);
    if (!gatewayRefund) {
      gatewayRefund = await razorpay.createGatewayRefund({
        gatewayPaymentId: payment.gatewayPaymentId,
        amountPaise,
        receipt: ret.returnNumber.slice(0, 40),
        notes: { returnId: ret.id, returnNumber: ret.returnNumber },
      });
    }
  } catch (err) {
    if (isDefiniteRejection(err)) {
      await markRefundFailed(ret.id, gatewayMessage(err));
      throw ApiError.conflict(
        "Refund could not be started with the payment provider. The return is marked REFUND_FAILED and can be retried"
      );
    }
    // Unknown outcome: a refund may exist at Razorpay. Keep REFUND_INITIATED; the webhook decides.
    console.error("[returns] refund outcome unknown", { returnId: ret.id, error: gatewayMessage(err) });
    throw ApiError.conflict(
      "The payment provider did not answer. The return stays REFUND_INITIATED and will be updated when the provider confirms. If nothing changes in a few minutes, call refund again"
    );
  }

  if (Number(gatewayRefund.amount) !== amountPaise) {
    throw ApiError.conflict("The refund found at the payment provider has a different amount. Please check it manually");
  }

  // Phase 3: save the refund and link it to the return.
  // The return stays REFUND_INITIATED. Only the webhook (refund.processed) makes it REFUNDED.
  await prisma.$transaction(async (tx) => {
    const refundRow = await tx.paymentRefund.upsert({
      where: { gatewayRefundId: gatewayRefund.id },
      create: {
        paymentId: payment.id,
        gatewayRefundId: gatewayRefund.id,
        amount: ret.refundAmount,
        currency: ret.currency,
        status: "PENDING",
      },
      update: {}, // the webhook may already have created and updated it
    });
    await tx.returnRequest.update({
      where: { id: ret.id },
      data: { paymentRefundId: refundRow.id },
    });
  });

  return prisma.returnRequest.findUnique({ where: { id: ret.id }, include: returnInclude });
}

module.exports = { refundReturn };