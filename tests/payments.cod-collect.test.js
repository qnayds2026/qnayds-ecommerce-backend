jest.mock("../src/config/db", () => ({
  prisma: {
    payment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("../src/modules/payments/razorpay.service", () => ({
  assertConfigured: jest.fn(),
  createGatewayOrder: jest.fn(),
  toPaise: jest.fn((amount) => Math.round(parseFloat(amount) * 100)),
  getKeyId: jest.fn(() => "rzp_test_key"),
}));

jest.mock("../src/modules/webhooks/razorpay.events", () => ({ handlers: {} }));

const { prisma } = require("../src/config/db");
const paymentsService = require("../src/modules/payments/payments.service");

const admin = { id: "admin_1" };

const order = (overrides = {}) => ({
  id: "order_db_1",
  userId: "user_1",
  orderNumber: "ORD-1001",
  status: "PENDING_PAYMENT",
  totalAmount: "499.00",
  currency: "INR",
  ...overrides,
});

describe("COD: conflicts between payment methods", () => {
  beforeEach(() => jest.clearAllMocks());

  test("an open COD row is never handed out as an online attempt", async () => {
    prisma.payment.findFirst.mockResolvedValue({ id: "pay_cod_1", method: "COD", status: "PENDING" });

    await expect(paymentsService.startPaymentForOrder(order())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  test("COD is refused when the order already has an online payment", async () => {
    prisma.payment.findFirst
      .mockResolvedValueOnce(null) // no COD row yet
      .mockResolvedValueOnce({ id: "pay_1", method: "ONLINE" }); // but an online one exists

    await expect(paymentsService.startCodPaymentForOrder(order())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});

describe("COD: collecting the cash (admin)", () => {
  beforeEach(() => jest.clearAllMocks());

  const codPayment = (overrides = {}) => ({
    id: "pay_cod_1",
    orderId: "order_db_1",
    method: "COD",
    status: "PENDING",
    ...overrides,
  });

  test("unknown payment returns 404", async () => {
    prisma.payment.findUnique.mockResolvedValue(null);
    await expect(paymentsService.collectCodPayment(admin, "x")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test("an online payment cannot be collected as cash", async () => {
    prisma.payment.findUnique.mockResolvedValue(codPayment({ method: "ONLINE" }));
    await expect(paymentsService.collectCodPayment(admin, "pay_cod_1")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test("cash cannot be collected before the order is delivered", async () => {
    prisma.payment.findUnique.mockResolvedValue(codPayment());
    prisma.order.findUnique.mockResolvedValue({ status: "SHIPPED" });

    await expect(paymentsService.collectCodPayment(admin, "pay_cod_1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  test("delivered order: payment becomes CAPTURED", async () => {
    prisma.payment.findUnique
      .mockResolvedValueOnce(codPayment())
      .mockResolvedValueOnce(codPayment({ status: "CAPTURED" }));
    prisma.order.findUnique.mockResolvedValue({ status: "DELIVERED" });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });

    const result = await paymentsService.collectCodPayment(admin, "pay_cod_1");

    const call = prisma.payment.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "pay_cod_1", method: "COD", status: "PENDING" });
    expect(call.data.status).toBe("CAPTURED");
    expect(call.data.capturedAt).toBeInstanceOf(Date);
    expect(result.status).toBe("CAPTURED");
  });

  test("collecting twice is idempotent", async () => {
    prisma.payment.findUnique.mockResolvedValue(codPayment({ status: "CAPTURED" }));

    const result = await paymentsService.collectCodPayment(admin, "pay_cod_1");

    expect(result.status).toBe("CAPTURED");
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  test("a concurrent status change returns 409", async () => {
    prisma.payment.findUnique.mockResolvedValue(codPayment());
    prisma.order.findUnique.mockResolvedValue({ status: "DELIVERED" });
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(paymentsService.collectCodPayment(admin, "pay_cod_1")).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});