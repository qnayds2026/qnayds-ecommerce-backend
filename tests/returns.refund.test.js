jest.mock("../src/config/db", () => ({
  prisma: {
    returnRequest: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../src/modules/payments/razorpay.service", () => ({
  assertConfigured: jest.fn(),
  createGatewayRefund: jest.fn(),
  findGatewayRefundForReturn: jest.fn(),
  toPaise: jest.fn((amount) => Math.round(parseFloat(amount) * 100)),
}));

jest.mock("../src/modules/payments/order-confirmation", () => ({
  confirmOrder: jest.fn(),
}));

const { Prisma } = require("@prisma/client");
const { prisma } = require("../src/config/db");
const razorpay = require("../src/modules/payments/razorpay.service");
const refundService = require("../src/modules/returns/returns.refund.service");
const hooks = require("../src/modules/webhooks/webhooks.hooks");

const admin = { id: "user_admin", role: "ADMIN" };

const makePayment = (overrides = {}) => ({
  id: "pay_1",
  method: "ONLINE",
  gatewayPaymentId: "pay_gw_1",
  status: "CAPTURED",
  amount: "1000.00",
  ...overrides,
});

const makeReturn = (overrides = {}) => ({
  id: "ret_1",
  returnNumber: "RET-1",
  status: "ITEM_RECEIVED",
  refundAmount: "500.00",
  currency: "INR",
  paymentRefundId: null,
  updatedAt: new Date(),
  payment: makePayment(),
  ...overrides,
});

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

describe("returns.refund.service refundReturn", () => {
  let tx;

  beforeEach(() => {
    jest.clearAllMocks();
    razorpay.assertConfigured.mockReset();

    tx = {
      returnRequest: {
        findUnique: jest.fn().mockResolvedValue(makeReturn()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      paymentRefund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
        upsert: jest.fn().mockResolvedValue({ id: "pr_1" }),
      },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    prisma.returnRequest.findUnique.mockResolvedValue({ id: "ret_1", status: "REFUND_INITIATED" });

    // By default Razorpay has no refund for this return yet, and creating one works (amount in paise).
    razorpay.findGatewayRefundForReturn.mockReset();
    razorpay.findGatewayRefundForReturn.mockResolvedValue(null);
    razorpay.createGatewayRefund.mockReset();
    razorpay.createGatewayRefund.mockResolvedValue({ id: "rfnd_gw_1", amount: 50000 });
  });

  test("Razorpay keys missing: nothing is changed", async () => {
    razorpay.assertConfigured.mockImplementation(() => {
      throw new Error("Razorpay keys are not configured");
    });

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
  });

  test("return that is not ITEM_RECEIVED yet cannot be refunded (409)", async () => {
    tx.returnRequest.findUnique.mockResolvedValue(makeReturn({ status: "APPROVED" }));

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
  });

  test.each(["REFUND_INITIATED", "REFUNDED", "CLOSED"])(
    "duplicate refund call on a %s return: no second refund, no new audit row",
    async (status) => {
      tx.returnRequest.findUnique.mockResolvedValue(makeReturn({ status }));

      const result = await refundService.refundReturn(admin, "ret_1");

      expect(result.id).toBe("ret_1");
      expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
    }
  );

  test("order that was not paid online needs a manual refund (409)", async () => {
    tx.returnRequest.findUnique.mockResolvedValue(
      makeReturn({ payment: makePayment({ method: "COD", gatewayPaymentId: null }) })
    );

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
  });

  test("payment that is not in a refundable state is rejected (409)", async () => {
    tx.returnRequest.findUnique.mockResolvedValue(
      makeReturn({ payment: makePayment({ status: "FAILED" }) })
    );

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
  });

  test("refund is blocked when it would be more than what is left on the payment (409)", async () => {
    // 800 already refunded or pending, this return needs 500, payment is 1000
    tx.paymentRefund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("800.00") } });

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
  });

  test("two admins click at the same moment: the second one gets the current record, only one refund", async () => {
    tx.returnRequest.findUnique
      .mockResolvedValueOnce(makeReturn())
      .mockResolvedValueOnce({ id: "ret_1", status: "REFUND_INITIATED" });
    tx.returnRequest.updateMany.mockResolvedValue({ count: 0 });

    const result = await refundService.refundReturn(admin, "ret_1");

    expect(result.id).toBe("ret_1");
    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
  });

  test("status changed to something else at the same moment: 409", async () => {
    tx.returnRequest.findUnique
      .mockResolvedValueOnce(makeReturn())
      .mockResolvedValueOnce({ id: "ret_1", status: "CANCELLED" });
    tx.returnRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
  });

  test("successful call: amount comes from the stored return, refund is linked, return is NOT marked REFUNDED", async () => {
    await refundService.refundReturn(admin, "ret_1", "Item checked");

    // Razorpay is asked first whether this return already has a refund
    expect(razorpay.findGatewayRefundForReturn).toHaveBeenCalledWith("pay_gw_1", "ret_1");

    // amount in paise, taken from the stored return (the client sends no amount)
    expect(razorpay.createGatewayRefund.mock.calls[0][0]).toMatchObject({
      gatewayPaymentId: "pay_gw_1",
      amountPaise: 50000,
      notes: { returnId: "ret_1", returnNumber: "RET-1" },
    });

    // claim step: status checked in the same update, idempotency key stored
    const claim = tx.returnRequest.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: "ret_1", status: "ITEM_RECEIVED" });
    expect(claim.data.status).toBe("REFUND_INITIATED");
    expect(claim.data.refundIdempotencyKey).toMatch(/^RET-1:/);

    expect(tx.returnStatusHistory.create.mock.calls[0][0].data).toMatchObject({
      oldStatus: "ITEM_RECEIVED",
      newStatus: "REFUND_INITIATED",
      changedBy: "user_admin",
      actorRole: "ADMIN",
    });

    // refund row is saved as PENDING and linked to the return
    expect(tx.paymentRefund.upsert.mock.calls[0][0].create).toMatchObject({
      paymentId: "pay_1",
      gatewayRefundId: "rfnd_gw_1",
      status: "PENDING",
    });
    expect(tx.returnRequest.update.mock.calls[0][0].data).toEqual({ paymentRefundId: "pr_1" });

    // only the webhook can make it REFUNDED
    const allData = [
      ...tx.returnRequest.updateMany.mock.calls,
      ...tx.returnRequest.update.mock.calls,
    ].map((c) => c[0].data);
    expect(allData.some((d) => d.status === "REFUNDED")).toBe(false);
  });

  test("a REFUND_FAILED return can be retried by the admin", async () => {
    tx.returnRequest.findUnique.mockResolvedValue(makeReturn({ status: "REFUND_FAILED" }));

    await refundService.refundReturn(admin, "ret_1");

    expect(razorpay.createGatewayRefund).toHaveBeenCalledTimes(1);
    expect(tx.returnRequest.updateMany.mock.calls[0][0].where).toEqual({
      id: "ret_1",
      status: "REFUND_FAILED",
    });
  });

  test("provider rejects the refund (4xx): return becomes REFUND_FAILED, no refund row, 409 with a clear message", async () => {
    razorpay.createGatewayRefund.mockRejectedValue({
      statusCode: 400,
      error: { description: "Insufficient balance" },
    });

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });

    // 1st updateMany = claim, 2nd = mark failed (only from REFUND_INITIATED)
    const failed = tx.returnRequest.updateMany.mock.calls[1][0];
    expect(failed.where).toEqual({ id: "ret_1", status: "REFUND_INITIATED" });
    expect(failed.data.status).toBe("REFUND_FAILED");
    expect(failed.data.refundIdempotencyKey).toBeNull();

    const failedAudit = tx.returnStatusHistory.create.mock.calls[1][0].data;
    expect(failedAudit).toMatchObject({
      oldStatus: "REFUND_INITIATED",
      newStatus: "REFUND_FAILED",
      actorRole: "SYSTEM",
    });
    expect(failedAudit.note).toContain("Insufficient balance");

    expect(tx.paymentRefund.upsert).not.toHaveBeenCalled();
    expect(tx.returnRequest.update).not.toHaveBeenCalled();
  });

  test.each([
    ["a timeout / network error (no status code)", new Error("socket hang up")],
    ["a Razorpay server error (5xx)", { statusCode: 502, error: { description: "Bad gateway" } }],
  ])(
    "outcome unknown after %s: return stays REFUND_INITIATED, is NOT marked failed, nothing is saved",
    async (_label, err) => {
      razorpay.createGatewayRefund.mockRejectedValue(err);
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining("did not answer"),
      });

      // only the claim update happened, no REFUND_FAILED
      expect(tx.returnRequest.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.returnStatusHistory.create).toHaveBeenCalledTimes(1);
      expect(tx.paymentRefund.upsert).not.toHaveBeenCalled();
      expect(tx.returnRequest.update).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    }
  );

  test("looking up existing refunds fails: no new refund is created", async () => {
    razorpay.findGatewayRefundForReturn.mockRejectedValue(new Error("socket hang up"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    expect(tx.returnRequest.updateMany).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  test("Razorpay already has a refund for this return: it is reused, no second refund is created", async () => {
    razorpay.findGatewayRefundForReturn.mockResolvedValue({ id: "rfnd_existing", amount: 50000 });

    await refundService.refundReturn(admin, "ret_1");

    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    expect(tx.paymentRefund.upsert.mock.calls[0][0].where).toEqual({
      gatewayRefundId: "rfnd_existing",
    });
    expect(tx.paymentRefund.upsert.mock.calls[0][0].create.gatewayRefundId).toBe("rfnd_existing");
    expect(tx.returnRequest.update.mock.calls[0][0].data).toEqual({ paymentRefundId: "pr_1" });
  });

  test("existing refund with a different amount is not linked (409)", async () => {
    razorpay.findGatewayRefundForReturn.mockResolvedValue({ id: "rfnd_existing", amount: 99900 });

    await expect(refundService.refundReturn(admin, "ret_1")).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    expect(tx.paymentRefund.upsert).not.toHaveBeenCalled();
  });

  describe("stalled REFUND_INITIATED (our call never finished)", () => {
    test("after a few minutes without a saved refund, calling refund again resumes it", async () => {
      const stalledAt = minutesAgo(5);
      tx.returnRequest.findUnique.mockResolvedValue(
        makeReturn({ status: "REFUND_INITIATED", paymentRefundId: null, updatedAt: stalledAt })
      );

      await refundService.refundReturn(admin, "ret_1");

      // claim is guarded by status, no saved refund, and the exact updatedAt we read
      expect(tx.returnRequest.updateMany.mock.calls[0][0].where).toEqual({
        id: "ret_1",
        status: "REFUND_INITIATED",
        paymentRefundId: null,
        updatedAt: stalledAt,
      });
      // the payment total was checked when the refund was first claimed
      expect(tx.paymentRefund.aggregate).not.toHaveBeenCalled();
      expect(razorpay.findGatewayRefundForReturn).toHaveBeenCalledTimes(1);
      expect(razorpay.createGatewayRefund).toHaveBeenCalledTimes(1);
      expect(tx.returnStatusHistory.create.mock.calls[0][0].data.note).toContain("resumed");
      expect(tx.returnRequest.update.mock.calls[0][0].data).toEqual({ paymentRefundId: "pr_1" });
    });

    test("a recent REFUND_INITIATED is left alone (the first call may still be running)", async () => {
      tx.returnRequest.findUnique.mockResolvedValue(
        makeReturn({ status: "REFUND_INITIATED", paymentRefundId: null, updatedAt: minutesAgo(0) })
      );

      await refundService.refundReturn(admin, "ret_1");

      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
      expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    });

    test("an old REFUND_INITIATED that already has a saved refund is not resumed", async () => {
      tx.returnRequest.findUnique.mockResolvedValue(
        makeReturn({ status: "REFUND_INITIATED", paymentRefundId: "pr_1", updatedAt: minutesAgo(30) })
      );

      await refundService.refundReturn(admin, "ret_1");

      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
      expect(razorpay.findGatewayRefundForReturn).not.toHaveBeenCalled();
      expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    });

    test("two admins resume at the same moment: only one goes on to Razorpay", async () => {
      tx.returnRequest.findUnique
        .mockResolvedValueOnce(
          makeReturn({ status: "REFUND_INITIATED", paymentRefundId: null, updatedAt: minutesAgo(5) })
        )
        .mockResolvedValueOnce({ id: "ret_1", status: "REFUND_INITIATED" });
      tx.returnRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await refundService.refundReturn(admin, "ret_1");

      expect(result.id).toBe("ret_1");
      expect(razorpay.findGatewayRefundForReturn).not.toHaveBeenCalled();
      expect(razorpay.createGatewayRefund).not.toHaveBeenCalled();
    });
  });
});

describe("webhooks.hooks onRefundEvent", () => {
  let tx;
  const refundRow = { id: "pr_1" };

  beforeEach(() => {
    jest.clearAllMocks();

    tx = {
      returnRequest: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "ret_1", status: "REFUND_INITIATED", paymentRefundId: "pr_1" }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
  });

  test("a refund that does not belong to a return is ignored", async () => {
    tx.returnRequest.findFirst.mockResolvedValue(null);

    await hooks.onRefundEvent(tx, { refundRow, refundStatus: "PROCESSED", notes: {} });

    expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
  });

  test("the return is found through the refund link or the returnId in the Razorpay notes", async () => {
    await hooks.onRefundEvent(tx, {
      refundRow,
      refundStatus: "PROCESSED",
      notes: { returnId: "ret_1" },
    });

    expect(tx.returnRequest.findFirst.mock.calls[0][0].where.OR).toEqual([
      { paymentRefundId: "pr_1" },
      { id: "ret_1" },
    ]);
  });

  test("refund.processed makes the return REFUNDED and records the system action", async () => {
    await hooks.onRefundEvent(tx, { refundRow, refundStatus: "PROCESSED", notes: {} });

    const call = tx.returnRequest.updateMany.mock.calls[0][0];
    expect(call.where.status.in).toEqual(["REFUND_INITIATED", "REFUND_FAILED"]);
    expect(call.data.status).toBe("REFUNDED");
    expect(call.data.refundedAt).toBeInstanceOf(Date);
    expect(tx.returnStatusHistory.create.mock.calls[0][0].data).toMatchObject({
      oldStatus: "REFUND_INITIATED",
      newStatus: "REFUNDED",
      actorRole: "SYSTEM",
    });
  });

  test("refund.processed after our call timed out (REFUND_FAILED) still ends as REFUNDED", async () => {
    tx.returnRequest.findFirst.mockResolvedValue({
      id: "ret_1",
      status: "REFUND_FAILED",
      paymentRefundId: "pr_1",
    });

    await hooks.onRefundEvent(tx, { refundRow, refundStatus: "PROCESSED", notes: {} });

    expect(tx.returnRequest.updateMany.mock.calls[0][0].data.status).toBe("REFUNDED");
    expect(tx.returnStatusHistory.create.mock.calls[0][0].data.oldStatus).toBe("REFUND_FAILED");
  });

  test("refund.failed makes the return REFUND_FAILED so the admin can retry", async () => {
    await hooks.onRefundEvent(tx, { refundRow, refundStatus: "FAILED", notes: {} });

    const call = tx.returnRequest.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "ret_1", status: "REFUND_INITIATED" });
    expect(call.data.status).toBe("REFUND_FAILED");
    expect(call.data.refundIdempotencyKey).toBeNull();
  });

  test("same event delivered twice: no second audit row", async () => {
    tx.returnRequest.updateMany.mockResolvedValue({ count: 0 });

    await hooks.onRefundEvent(tx, { refundRow, refundStatus: "PROCESSED", notes: {} });

    expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
  });

  test("late event of an older failed refund does not touch a retried return", async () => {
    tx.returnRequest.findFirst.mockResolvedValue({
      id: "ret_1",
      status: "REFUND_INITIATED",
      paymentRefundId: "pr_NEW",
    });

    await hooks.onRefundEvent(tx, {
      refundRow: { id: "pr_OLD" },
      refundStatus: "FAILED",
      notes: { returnId: "ret_1" },
    });

    expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.returnRequest.update).not.toHaveBeenCalled();
  });

  test("webhook arriving before our own save links the refund to the return", async () => {
    tx.returnRequest.findFirst.mockResolvedValue({
      id: "ret_1",
      status: "REFUND_INITIATED",
      paymentRefundId: null,
    });

    await hooks.onRefundEvent(tx, {
      refundRow,
      refundStatus: "PROCESSED",
      notes: { returnId: "ret_1" },
    });

    expect(tx.returnRequest.update.mock.calls[0][0]).toEqual({
      where: { id: "ret_1" },
      data: { paymentRefundId: "pr_1" },
    });
  });

  test("refund.created (PENDING) does not change the return status", async () => {
    await hooks.onRefundEvent(tx, { refundRow, refundStatus: "PENDING", notes: {} });

    expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
  });
});