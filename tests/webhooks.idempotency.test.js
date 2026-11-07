jest.mock("../src/config/db", () => ({
  prisma: { $transaction: jest.fn() },
}));

jest.mock("../src/modules/webhooks/razorpay.events", () => ({
  handlers: {
    "payment.captured": jest.fn(),
  },
}));

const { prisma } = require("../src/config/db");
const { handlers } = require("../src/modules/webhooks/razorpay.events");
const { processEvent } = require("../src/modules/webhooks/webhooks.service");

const makeTx = () => ({
  webhookEvent: {
    create: jest.fn().mockResolvedValue({ id: "row_1" }),
    update: jest.fn().mockResolvedValue({}),
  },
});

const capturedEvent = { event: "payment.captured", payload: {} };

describe("processEvent (webhook idempotency)", () => {
  let tx;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = makeTx();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
  });

  test("new event: stores event row, runs handler, marks PROCESSED", async () => {
    handlers["payment.captured"].mockResolvedValue("APPLIED");

    const outcome = await processEvent({ eventId: "evt_1", event: capturedEvent });

    expect(outcome).toBe("APPLIED");
    expect(tx.webhookEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.webhookEvent.create.mock.calls[0][0].data.eventId).toBe("evt_1");
    expect(handlers["payment.captured"]).toHaveBeenCalledTimes(1);
    expect(tx.webhookEvent.update.mock.calls[0][0].data.status).toBe("PROCESSED");
    expect(tx.webhookEvent.update.mock.calls[0][0].data.outcome).toBe("APPLIED");
  });

  test("duplicate event id: returns DUPLICATE and handler does not run", async () => {
    const err = new Error("Unique constraint failed");
    err.code = "P2002";
    tx.webhookEvent.create.mockRejectedValue(err);

    const outcome = await processEvent({ eventId: "evt_1", event: capturedEvent });

    expect(outcome).toBe("DUPLICATE");
    expect(handlers["payment.captured"]).not.toHaveBeenCalled();
    expect(tx.webhookEvent.update).not.toHaveBeenCalled();
  });

  test("handler error is rethrown (not treated as duplicate) so Razorpay retries", async () => {
    handlers["payment.captured"].mockRejectedValue(new Error("db down"));

    await expect(
      processEvent({ eventId: "evt_2", event: capturedEvent })
    ).rejects.toThrow("db down");

    expect(tx.webhookEvent.update).not.toHaveBeenCalled();
  });

  test("unsupported event type is stored and ignored", async () => {
    const outcome = await processEvent({
      eventId: "evt_3",
      event: { event: "something.else", payload: {} },
    });

    expect(outcome).toBe("IGNORED_UNSUPPORTED_EVENT");
    expect(handlers["payment.captured"]).not.toHaveBeenCalled();
  });
});