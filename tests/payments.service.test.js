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

const { prisma } = require("../src/config/db");
const razorpay = require("../src/modules/payments/razorpay.service");
const paymentsService = require("../src/modules/payments/payments.service");

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

describe("payments.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getPayment", () => {
    test("returns own payment", async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: "pay_1", status: "CAPTURED" });

      const result = await paymentsService.getPayment(user, "pay_1");

      expect(result.id).toBe("pay_1");
      expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({
        id: "pay_1",
        userId: "user_1",
      });
    });

    test("someone else's payment looks like a missing one (404)", async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(paymentsService.getPayment(user, "pay_other")).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe("createRazorpayOrder", () => {
    test("someone else's order looks like a missing one (404), no gateway call", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        paymentsService.createRazorpayOrder(user, { orderId: "order_other" })
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({
        id: "order_other",
        userId: "user_1",
      });
      expect(razorpay.createGatewayOrder).not.toHaveBeenCalled();
    });

    test("amount sent to Razorpay comes from the stored order, in paise", async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payment.count.mockResolvedValue(0);
      razorpay.createGatewayOrder.mockResolvedValue({ id: "order_gw_1" });
      prisma.payment.create.mockImplementation(async ({ data }) => ({
        id: "pay_new",
        ...data,
      }));

      const result = await paymentsService.createRazorpayOrder(user, {
        orderId: "order_db_1",
      });

      expect(razorpay.createGatewayOrder.mock.calls[0][0].amountPaise).toBe(49900);
      expect(result.amount).toBe(49900);
      expect(result.keyId).toBe("rzp_test_key");
      expect(result).not.toHaveProperty("keySecret");
    });
  });

  describe("startPaymentForOrder", () => {
    test("reuses an open attempt instead of creating a new one", async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: "pay_open", status: "CREATED" });

      const result = await paymentsService.startPaymentForOrder(makeOrder());

      expect(result.id).toBe("pay_open");
      expect(razorpay.createGatewayOrder).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    test("rejects an order that is not awaiting payment (409)", async () => {
      await expect(
        paymentsService.startPaymentForOrder(makeOrder({ status: "PAID" }))
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    test("rejects after 5 attempts (409)", async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payment.count.mockResolvedValue(5);

      await expect(
        paymentsService.startPaymentForOrder(makeOrder())
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(razorpay.createGatewayOrder).not.toHaveBeenCalled();
    });

    test("rejects an amount below the Razorpay minimum (400)", async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.payment.count.mockResolvedValue(0);

      await expect(
        paymentsService.startPaymentForOrder(makeOrder({ totalAmount: "0.50" }))
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(razorpay.createGatewayOrder).not.toHaveBeenCalled();
    });
  });

  describe("retryPayment", () => {
    test("someone else's payment looks like a missing one (404)", async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        paymentsService.retryPayment(user, "pay_other")
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    test("only FAILED payments can be retried (409)", async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: "pay_1",
        orderId: "order_db_1",
        status: "CAPTURED",
      });

      await expect(
        paymentsService.retryPayment(user, "pay_1")
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(razorpay.createGatewayOrder).not.toHaveBeenCalled();
    });

    test("retry of a FAILED payment creates a NEW attempt, old one is untouched", async () => {
      prisma.payment.findFirst
        .mockResolvedValueOnce({ id: "pay_failed", orderId: "order_db_1", status: "FAILED" })
        .mockResolvedValueOnce(null); // no open attempt
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      prisma.payment.count.mockResolvedValue(1);
      razorpay.createGatewayOrder.mockResolvedValue({ id: "order_gw_2" });
      prisma.payment.create.mockImplementation(async ({ data }) => ({
        id: "pay_new",
        ...data,
      }));

      const result = await paymentsService.retryPayment(user, "pay_failed");

      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
      expect(prisma.payment.create.mock.calls[0][0].data.gatewayOrderId).toBe("order_gw_2");
      expect(result.paymentId).toBe("pay_new");
      expect(result.gatewayOrderId).toBe("order_gw_2");
      // History is preserved: this service never updates or deletes payments.
      expect(prisma.payment.update).toBeUndefined();
      expect(prisma.payment.delete).toBeUndefined();
    });
  });

  describe("verifyPayment", () => {
    const body = {
      razorpay_order_id: "order_gw_1",
      razorpay_payment_id: "pay_gw_1",
      razorpay_signature: "sig",
    };

    test("someone else's payment looks like a missing one (404)", async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(paymentsService.verifyPayment(user, body)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(razorpay.fetchGatewayPayment).not.toHaveBeenCalled();
    });

    test("invalid signature is rejected (400) before calling Razorpay", async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: "pay_1" });
      razorpay.verifyPaymentSignature.mockReturnValue(false);

      await expect(paymentsService.verifyPayment(user, body)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(razorpay.fetchGatewayPayment).not.toHaveBeenCalled();
    });

    test("payment belonging to another gateway order is rejected (400)", async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: "pay_1" });
      razorpay.verifyPaymentSignature.mockReturnValue(true);
      razorpay.fetchGatewayPayment.mockResolvedValue({
        id: "pay_gw_1",
        order_id: "order_gw_OTHER",
        status: "captured",
      });

      await expect(paymentsService.verifyPayment(user, body)).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });
});