jest.mock("../src/config/db", () => ({
  prisma: {
    payment: {
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../src/modules/payments/razorpay.service", () => ({
  assertConfigured: jest.fn(),
  createGatewayOrder: jest.fn(),
  toPaise: jest.fn((amount) => Math.round(parseFloat(amount) * 100)),
  getKeyId: jest.fn(() => "rzp_test_key"),
  verifyPaymentSignature: jest.fn(),
  fetchGatewayPayment: jest.fn(),
}));

jest.mock("../src/modules/webhooks/razorpay.events", () => ({ handlers: {} }));

jest.mock("../src/services/orders.service", () => ({
  createOrder: jest.fn(),
}));

const { prisma } = require("../src/config/db");
const razorpay = require("../src/modules/payments/razorpay.service");
const ordersService = require("../src/services/orders.service");
const paymentsService = require("../src/modules/payments/payments.service");
const checkoutService = require("../src/modules/checkout/checkout.service");
const { checkoutBody } = require("../src/modules/checkout/checkout.validation");

const user = { id: "user_1" };

const makeOrder = (overrides = {}) => ({
  id: "order_db_1",
  userId: "user_1",
  orderNumber: "ORD-1001",
  status: "PENDING_PAYMENT",
  totalAmount: "499.00",
  currency: "INR",
  ...overrides,
});

describe("COD payments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("COD checkout creates a PENDING COD payment without calling Razorpay", async () => {
    ordersService.createOrder.mockResolvedValue(makeOrder());
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.payment.create.mockImplementation(async ({ data }) => ({ id: "pay_cod_1", ...data }));

    const result = await checkoutService.checkout(
      user,
      { addressId: "addr_1", paymentMethod: "COD" },
      "key-1"
    );

    expect(razorpay.assertConfigured).not.toHaveBeenCalled();
    expect(razorpay.createGatewayOrder).not.toHaveBeenCalled();

    const data = prisma.payment.create.mock.calls[0][0].data;
    expect(data.method).toBe("COD");
    expect(data.status).toBe("PENDING");
    expect(data.gatewayOrderId).toBeUndefined();

    expect(result.payment.method).toBe("COD");
    expect(result.payment.keyId).toBeUndefined();
  });

  test("COD again for the same order reuses the existing row", async () => {
    prisma.payment.findFirst.mockResolvedValue({ id: "pay_cod_1", method: "COD", status: "PENDING" });

    const payment = await paymentsService.startCodPaymentForOrder(makeOrder());

    expect(payment.id).toBe("pay_cod_1");
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  test("COD is rejected when the order is not awaiting payment", async () => {
    await expect(
      paymentsService.startCodPaymentForOrder(makeOrder({ status: "CANCELLED" }))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("/razorpay/order on a COD order returns 409", async () => {
    prisma.order.findFirst.mockResolvedValue(makeOrder());
    prisma.payment.findFirst.mockResolvedValue({ id: "pay_cod_1", method: "COD", status: "PENDING" });

    await expect(
      paymentsService.createRazorpayOrder(user, { orderId: "order_db_1" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("no paymentMethod defaults to ONLINE and creates a Razorpay order", async () => {
    ordersService.createOrder.mockResolvedValue(makeOrder());
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.payment.count.mockResolvedValue(0);
    razorpay.createGatewayOrder.mockResolvedValue({ id: "order_rzp_1" });
    prisma.payment.create.mockImplementation(async ({ data }) => ({ id: "pay_1", ...data }));

    const body = checkoutBody.parse({ addressId: "addr_1" });
    const result = await checkoutService.checkout(user, body, "key-2");

    expect(body.paymentMethod).toBe("ONLINE");
    expect(razorpay.assertConfigured).toHaveBeenCalled();
    expect(razorpay.createGatewayOrder).toHaveBeenCalled();
    expect(result.payment.gatewayOrderId).toBe("order_rzp_1");
  });

  describe("checkout validation", () => {
    test("accepts COD and ONLINE", () => {
      expect(checkoutBody.safeParse({ addressId: "a", paymentMethod: "COD" }).success).toBe(true);
      expect(checkoutBody.safeParse({ addressId: "a", paymentMethod: "ONLINE" }).success).toBe(true);
    });

    test("rejects an unknown payment method", () => {
      expect(checkoutBody.safeParse({ addressId: "a", paymentMethod: "CASH" }).success).toBe(false);
    });

    test("still rejects client-sent totals", () => {
      expect(checkoutBody.safeParse({ addressId: "a", totalAmount: 1 }).success).toBe(false);
    });
  });
});