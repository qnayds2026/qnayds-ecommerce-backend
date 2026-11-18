jest.mock("../src/modules/webhooks/webhooks.hooks", () => ({
  onPaymentCaptured: jest.fn(),
  onPaymentFailed: jest.fn(),
  onPaymentRefunded: jest.fn(),
  notifyAdmins: jest.fn().mockResolvedValue([]),
}));

const hooks = require("../src/modules/webhooks/webhooks.hooks");
const { handlers } = require("../src/modules/webhooks/razorpay.events");

// Minimal stand-in for a Prisma Decimal (amountMatches only uses mul + toFixed).
const decimal = (rupees) => ({
  mul: (n) => ({ toFixed: () => String(Math.round(parseFloat(rupees) * n)) }),
});

const makePayment = (status, overrides = {}) => ({
  id: "pay_db_1",
  gatewayOrderId: "order_1",
  amount: decimal("499.00"),
  currency: "INR",
  status,
  ...overrides,
});

const makeTx = (payment) => ({
  payment: {
    findUnique: jest.fn().mockResolvedValue(payment),
    update: jest.fn().mockImplementation(async ({ data }) => ({ ...payment, ...data })),
  },
});

const makeEvent = (name, entityOverrides = {}) => ({
  event: name,
  payload: {
    payment: {
      entity: {
        id: "pay_gw_1",
        order_id: "order_1",
        amount: 49900,
        currency: "INR",
        ...entityOverrides,
      },
    },
  },
});

describe("razorpay event handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  test("captured with matching amount: status CAPTURED and hook runs", async () => {
    const tx = makeTx(makePayment("CREATED"));

    const outcome = await handlers["payment.captured"](tx, {
      eventId: "evt_1",
      event: makeEvent("payment.captured"),
    });

    expect(outcome).toBe("APPLIED");
    const data = tx.payment.update.mock.calls[0][0].data;
    expect(data.status).toBe("CAPTURED");
    expect(data.gatewayPaymentId).toBe("pay_gw_1");
    expect(data.lastEventId).toBe("evt_1");
    expect(hooks.onPaymentCaptured).toHaveBeenCalledTimes(1);
  });

  test("amount mismatch: flagged for review, status not changed, no hook", async () => {
    const tx = makeTx(makePayment("CREATED"));

    const outcome = await handlers["payment.captured"](tx, {
      eventId: "evt_2",
      event: makeEvent("payment.captured", { amount: 49800 }),
    });

    expect(outcome).toBe("AMOUNT_MISMATCH");
    expect(tx.payment.update).toHaveBeenCalledTimes(1);
    const data = tx.payment.update.mock.calls[0][0].data;
    expect(data.requiresReview).toBe(true);
    expect(data.status).toBeUndefined();
    expect(hooks.onPaymentCaptured).not.toHaveBeenCalled();
  });

  test("currency mismatch: flagged for review, hook does not run", async () => {
    const tx = makeTx(makePayment("CREATED"));

    const outcome = await handlers["payment.captured"](tx, {
      eventId: "evt_3",
      event: makeEvent("payment.captured", { currency: "USD" }),
    });

    expect(outcome).toBe("AMOUNT_MISMATCH");
    expect(hooks.onPaymentCaptured).not.toHaveBeenCalled();
  });

  test("webhook before frontend verify: webhook applies, later verify event is a no-op", async () => {
    // Webhook arrives first, payment still CREATED.
    const first = makeTx(makePayment("CREATED"));
    const webhookOutcome = await handlers["payment.captured"](first, {
      eventId: "evt_4",
      event: makeEvent("payment.captured"),
    });
    expect(webhookOutcome).toBe("APPLIED");

    // Frontend verify runs afterwards with its own event id, payment is now CAPTURED.
    const second = makeTx(makePayment("CAPTURED"));
    const verifyOutcome = await handlers["payment.captured"](second, {
      eventId: "verify_pay_gw_1",
      event: makeEvent("payment.captured"),
    });
    expect(verifyOutcome).toBe("NO_CHANGE");
    expect(second.payment.update).not.toHaveBeenCalled();
    expect(hooks.onPaymentCaptured).toHaveBeenCalledTimes(1);
  });

  test("late authorized event never downgrades a CAPTURED payment", async () => {
    const tx = makeTx(makePayment("CAPTURED"));

    const outcome = await handlers["payment.authorized"](tx, {
      eventId: "evt_5",
      event: makeEvent("payment.authorized"),
    });

    expect(outcome).toBe("NO_CHANGE");
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  test("late failed event never downgrades a CAPTURED payment", async () => {
    const tx = makeTx(makePayment("CAPTURED"));

    const outcome = await handlers["payment.failed"](tx, {
      eventId: "evt_6",
      event: makeEvent("payment.failed"),
    });

    expect(outcome).toBe("NO_CHANGE");
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(hooks.onPaymentFailed).not.toHaveBeenCalled();
  });

  test("failed event: stores failure details and runs failed hook", async () => {
    const tx = makeTx(makePayment("PENDING"));

    const outcome = await handlers["payment.failed"](tx, {
      eventId: "evt_7",
      event: makeEvent("payment.failed", {
        error_code: "BAD_REQUEST_ERROR",
        error_description: "Payment failed",
      }),
    });

    expect(outcome).toBe("APPLIED");
    const data = tx.payment.update.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.failureCode).toBe("BAD_REQUEST_ERROR");
    expect(data.failureReason).toBe("Payment failed");
    expect(hooks.onPaymentFailed).toHaveBeenCalledTimes(1);
  });

  test("unknown gateway order is ignored", async () => {
    const tx = makeTx(null);

    const outcome = await handlers["payment.captured"](tx, {
      eventId: "evt_8",
      event: makeEvent("payment.captured", { order_id: "order_unknown" }),
    });

    expect(outcome).toBe("IGNORED_UNKNOWN_ORDER");
    expect(tx.payment.update).not.toHaveBeenCalled();
  });
});

