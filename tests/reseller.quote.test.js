jest.mock("../src/config/db", () => ({
  prisma: {
    resellerProfile: { findUnique: jest.fn() },
    order: { findFirst: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    resellerProductShare: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../src/services/orders.service", () => ({
  notifyOrderPlaced: jest.fn(),
}));

jest.mock("../src/modules/payments/payments.service", () => ({
  startCodPaymentForOrder: jest.fn(),
  toCodDetails: jest.fn(),
  startPaymentForOrder: jest.fn(),
  toClientDetails: jest.fn(),
}));

jest.mock("../src/modules/payments/razorpay.service", () => ({
  assertConfigured: jest.fn(),
}));

const { prisma } = require("../src/config/db");
const ordersService = require("../src/services/orders.service");
const paymentsService = require("../src/modules/payments/payments.service");
const razorpay = require("../src/modules/payments/razorpay.service");
const resellerOrders = require("../src/modules/reseller/reseller.orders.service");
const validation = require("../src/modules/reseller/reseller.validation");

const user = { id: "user_1", role: "CUSTOMER" };
const ORIGINAL_ENV = { ...process.env };

const variant = (overrides = {}) => ({
  id: "var_1",
  name: "bb",
  price: "100",
  sku: "SKU-1",
  attributes: null,
  inventory: { quantityAvailable: 5, quantityReserved: 0 },
  product: { id: "prod_1", name: "Speaker", sellerId: "seller_1" },
  ...overrides,
});

const customer = (overrides = {}) => ({
  name: "Test Customer",
  phone: "9876543210",
  addressLine1: "House 12, Main Road",
  city: "Thrissur",
  state: "Kerala",
  postalCode: "680001",
  ...overrides,
});

const body = (overrides = {}) => ({
  items: [{ variantId: "var_1", quantity: 2, margin: "10" }],
  customer: customer(),
  paymentMethod: "COD",
  ...overrides,
});

// The transaction client. Each test can override what it returns.
let tx;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.RESELLER_SHIPPING_CHARGE = "50";
  process.env.RESELLER_MAX_MARGIN_PERCENT = "50";

  tx = {
  productVariant: { findMany: jest.fn().mockResolvedValue([variant()]) },
  order: {
    create: jest.fn().mockResolvedValue({ id: "ord_1" }),
    findUnique: jest.fn().mockResolvedValue({
      id: "ord_1",
      orderNumber: "ORD-TEST",
      status: "PENDING_PAYMENT",
    }),
  },
  sellerOrder: { create: jest.fn().mockResolvedValue({ id: "so_1" }) },
  orderItem: { create: jest.fn().mockResolvedValue({}) },
  resellerEarning: {
    create: jest.fn().mockResolvedValue({}),
  },
  orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  $executeRaw: jest.fn().mockResolvedValue(1),
};

  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  prisma.resellerProfile.findUnique.mockResolvedValue({
    id: "rp_1",
    status: "APPROVED",
  });
  prisma.order.findFirst.mockResolvedValue(null);
  ordersService.notifyOrderPlaced.mockResolvedValue();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("reseller.orders.service createResellerOrder", () => {
  describe("idempotency key", () => {
    it.each([
      ["missing", undefined],
      ["not a string", 123],
      ["blank", "   "],
    ])("returns 400 when the key is %s", async (_name, key) => {
      await expect(
        resellerOrders.createResellerOrder(user, body(), key)
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.resellerProfile.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns 400 when the key is longer than 100 characters", async () => {
      await expect(
        resellerOrders.createResellerOrder(user, body(), "k".repeat(101))
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns the existing order for a repeated key without creating another", async () => {
      const existing = { id: "ord_old", orderNumber: "ORD-OLD" };
      prisma.order.findFirst.mockResolvedValue(existing);

      const result = await resellerOrders.createResellerOrder(user, body(), "key-1");

      expect(result).toBe(existing);
      expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({
        userId: "user_1",
        idempotencyKey: "key-1",
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("trims the key before using it", async () => {
      await resellerOrders.createResellerOrder(user, body(), "  key-2  ");

      expect(prisma.order.findFirst.mock.calls[0][0].where.idempotencyKey).toBe("key-2");
      expect(tx.order.create.mock.calls[0][0].data.idempotencyKey).toBe("key-2");
    });

    it("returns the other request's order when two requests race (P2002)", async () => {
      const duplicate = { id: "ord_dup", orderNumber: "ORD-DUP" };
      prisma.order.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(duplicate);
      prisma.$transaction.mockRejectedValue({ code: "P2002" });

      const result = await resellerOrders.createResellerOrder(user, body(), "key-3");

      expect(result).toBe(duplicate);
    });

    it("rethrows other database errors", async () => {
      prisma.$transaction.mockRejectedValue(new Error("db down"));

      await expect(
        resellerOrders.createResellerOrder(user, body(), "key-4")
      ).rejects.toThrow("db down");
    });
  });

  describe("authorization", () => {
    it("returns 404 when the user has no reseller profile", async () => {
      prisma.resellerProfile.findUnique.mockResolvedValue(null);

      await expect(
        resellerOrders.createResellerOrder(user, body(), "key-1")
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns 403 when the reseller is not approved", async () => {
      prisma.resellerProfile.findUnique.mockResolvedValue({
        id: "rp_1",
        status: "PENDING",
      });

      await expect(
        resellerOrders.createResellerOrder(user, body(), "key-1")
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("share code", () => {
    it("returns 400 for a share code that does not belong to this reseller", async () => {
      prisma.resellerProductShare.findFirst.mockResolvedValue(null);

      await expect(
        resellerOrders.createResellerOrder(user, body({ shareCode: "abc" }), "key-1")
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("looks the share code up only inside the logged-in reseller's shares", async () => {
      prisma.resellerProductShare.findFirst.mockResolvedValue({
  id: "share_1",
  productId: "prod_1",
});

      await resellerOrders.createResellerOrder(
        user,
        body({ shareCode: "abc" }),
        "key-1"
      );

      const where = prisma.resellerProductShare.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({ code: "abc", resellerId: "rp_1", isActive: true });
      expect(tx.order.create.mock.calls[0][0].data.resellerShareId).toBe("share_1");
    });

    it("saves no share when no share code is sent", async () => {
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      expect(prisma.resellerProductShare.findFirst).not.toHaveBeenCalled();
      expect(tx.order.create.mock.calls[0][0].data.resellerShareId).toBeNull();
    });
  });

  describe("eligibility, stock and margin", () => {
    it("looks the variants up with the eligibility rule", async () => {
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      const where = tx.productVariant.findMany.mock.calls[0][0].where;
      expect(where.id).toEqual({ in: ["var_1"] });
      expect(where.isActive).toBe(true);
      expect(where.product).toEqual({ status: "ACTIVE", isResellable: true });
    });

    it("returns 404 when a variant is not eligible", async () => {
      tx.productVariant.findMany.mockResolvedValue([]);

      await expect(
        resellerOrders.createResellerOrder(user, body(), "key-1")
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it("returns 404 when the variant has no inventory row", async () => {
      tx.productVariant.findMany.mockResolvedValue([variant({ inventory: null })]);

      await expect(
        resellerOrders.createResellerOrder(user, body(), "key-1")
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 409 when the free stock is lower than the quantity", async () => {
      // 5 available, 4 already reserved: only 1 is free.
      tx.productVariant.findMany.mockResolvedValue([
        variant({ inventory: { quantityAvailable: 5, quantityReserved: 4 } }),
      ]);

      await expect(
        resellerOrders.createResellerOrder(user, body(), "key-1")
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it("rejects a margin above the maximum with 400", async () => {
      await expect(
        resellerOrders.createResellerOrder(
          user,
          body({ items: [{ variantId: "var_1", quantity: 1, margin: "50.01" }] }),
          "key-1"
        )
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it("accepts a margin equal to the maximum", async () => {
      await resellerOrders.createResellerOrder(
        user,
        body({ items: [{ variantId: "var_1", quantity: 1, margin: "50" }] }),
        "key-1"
      );

      expect(tx.order.create).toHaveBeenCalledTimes(1);
    });

    it("returns 409 and rolls back when the stock changed during the order", async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        resellerOrders.createResellerOrder(user, body(), "key-1")
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("reserves the stock once per item", async () => {
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe("price snapshot", () => {
    it("saves price + shipping + margin as the customer total", async () => {
      // 2 x 100 = 200, shipping 50, margin 2 x 10 = 20
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      const data = tx.order.create.mock.calls[0][0].data;
      expect(data.totalAmount.toString()).toBe("270");
      expect(data.shippingCharge.toString()).toBe("50");
      expect(data.resellerMarginTotal.toString()).toBe("20");
      expect(data.currency).toBe("INR");
    });

    it("attributes the order to the reseller and starts it as PENDING_PAYMENT", async () => {
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      const data = tx.order.create.mock.calls[0][0].data;
      expect(data.resellerId).toBe("rp_1");
      expect(data.userId).toBe("user_1");
      expect(data.status).toBe("PENDING_PAYMENT");
      expect(data.idempotencyKey).toBe("key-1");
    });

    it("snapshots the unit price and margin on each order item", async () => {
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      const data = tx.orderItem.create.mock.calls[0][0].data;
      expect(data.unitPrice.toString()).toBe("100");
      expect(data.resellerMargin.toString()).toBe("10");
      expect(data.subtotal.toString()).toBe("200");
      expect(data.quantity).toBe(2);
      expect(data.productName).toBe("Speaker");
    });

    it("does not add the margin to the seller's total", async () => {
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      const data = tx.sellerOrder.create.mock.calls[0][0].data;
      expect(data.totalAmount.toString()).toBe("200");
    });

    it("uses the shipping charge from the server config", async () => {
      process.env.RESELLER_SHIPPING_CHARGE = "80";

      await resellerOrders.createResellerOrder(user, body(), "key-1");

      const data = tx.order.create.mock.calls[0][0].data;
      expect(data.shippingCharge.toString()).toBe("80");
      expect(data.totalAmount.toString()).toBe("300");
    });

    it("takes the price from the database, not from the request", async () => {
      tx.productVariant.findMany.mockResolvedValue([variant({ price: "250" })]);

      await resellerOrders.createResellerOrder(
        user,
        body({
          items: [
            { variantId: "var_1", quantity: 1, margin: "10", unitPrice: "1" },
          ],
        }),
        "key-1"
      );

      const data = tx.orderItem.create.mock.calls[0][0].data;
      expect(data.unitPrice.toString()).toBe("250");
    });

    it("saves the delivery details of the end customer", async () => {
      await resellerOrders.createResellerOrder(user, body(), "key-1");

      const data = tx.order.create.mock.calls[0][0].data;
      expect(data.deliveryName).toBe("Test Customer");
      expect(data.deliveryPhone).toBe("9876543210");
      expect(data.deliveryCity).toBe("Thrissur");
      expect(data.deliveryPostalCode).toBe("680001");
      expect(data.deliveryCountry).toBe("India");
    });
  });

  describe("multiple sellers", () => {
    it("creates one seller order per seller", async () => {
      tx.productVariant.findMany.mockResolvedValue([
        variant(),
        variant({
          id: "var_2",
          product: { id: "prod_2", name: "Cable", sellerId: "seller_2" },
        }),
      ]);

      await resellerOrders.createResellerOrder(
        user,
        body({
          items: [
            { variantId: "var_1", quantity: 1, margin: "10" },
            { variantId: "var_2", quantity: 1, margin: "5" },
          ],
        }),
        "key-1"
      );

      expect(tx.sellerOrder.create).toHaveBeenCalledTimes(2);
      expect(tx.orderItem.create).toHaveBeenCalledTimes(2);
      const total = tx.order.create.mock.calls[0][0].data.totalAmount.toString();
      // 100 + 100 + 50 shipping + 15 margin
      expect(total).toBe("265");
    });
  });

  describe("notifications", () => {
    it("still returns the order when the notification fails", async () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      ordersService.notifyOrderPlaced.mockRejectedValue(new Error("mail down"));

      const result = await resellerOrders.createResellerOrder(user, body(), "key-1");

      expect(result.orderNumber).toBe("ORD-TEST");
      spy.mockRestore();
    });
  });
});

describe("reseller.orders.service placeOrder", () => {
  it("starts a COD payment for a COD order", async () => {
    paymentsService.startCodPaymentForOrder.mockResolvedValue({ id: "pay_1" });
    paymentsService.toCodDetails.mockReturnValue({ method: "COD" });

    const result = await resellerOrders.placeOrder(user, body(), "key-1");

    expect(razorpay.assertConfigured).not.toHaveBeenCalled();
    expect(paymentsService.startCodPaymentForOrder).toHaveBeenCalledTimes(1);
    expect(paymentsService.startPaymentForOrder).not.toHaveBeenCalled();
    expect(result.payment).toEqual({ method: "COD" });
  });

  it("checks Razorpay before reserving any stock for an online order", async () => {
    razorpay.assertConfigured.mockImplementation(() => {
      throw new Error("Razorpay is not configured");
    });

    await expect(
      resellerOrders.placeOrder(user, body({ paymentMethod: "ONLINE" }), "key-1")
    ).rejects.toThrow("Razorpay is not configured");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("starts an online payment for an ONLINE order", async () => {
    paymentsService.startPaymentForOrder.mockResolvedValue({ id: "pay_2" });
    paymentsService.toClientDetails.mockReturnValue({ method: "ONLINE" });

    const result = await resellerOrders.placeOrder(
      user,
      body({ paymentMethod: "ONLINE" }),
      "key-1"
    );

    expect(razorpay.assertConfigured).toHaveBeenCalledTimes(1);
    expect(paymentsService.startPaymentForOrder).toHaveBeenCalledTimes(1);
    expect(result.payment).toEqual({ method: "ONLINE" });
  });

  it("treats a missing payment method as ONLINE", async () => {
    const { paymentMethod, ...rest } = body();
    paymentsService.startPaymentForOrder.mockResolvedValue({ id: "pay_3" });
    paymentsService.toClientDetails.mockReturnValue({ method: "ONLINE" });

    await resellerOrders.placeOrder(user, rest, "key-1");

    expect(razorpay.assertConfigured).toHaveBeenCalledTimes(1);
    expect(paymentsService.startCodPaymentForOrder).not.toHaveBeenCalled();
  });

  it("returns only the order summary, without seller or item details", async () => {
    paymentsService.startCodPaymentForOrder.mockResolvedValue({ id: "pay_1" });
    paymentsService.toCodDetails.mockReturnValue({ method: "COD" });
    tx.order.findUnique.mockResolvedValue({
      id: "ord_1",
      orderNumber: "ORD-TEST",
      status: "PENDING_PAYMENT",
      totalAmount: "270",
      shippingCharge: "50",
      resellerMarginTotal: "20",
      currency: "INR",
      sellerOrders: [{ sellerId: "seller_1" }],
      orderItems: [],
    });

    const result = await resellerOrders.placeOrder(user, body(), "key-1");

    expect(Object.keys(result.order).sort()).toEqual(
      [
        "currency",
        "id",
        "orderNumber",
        "resellerMarginTotal",
        "shippingCharge",
        "status",
        "totalAmount",
      ].sort()
    );
  });

  it("does not start a payment again for an order that is no longer pending payment", async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: "ord_old",
      orderNumber: "ORD-OLD",
      status: "CONFIRMED",
    });

    const result = await resellerOrders.placeOrder(user, body(), "key-1");

    expect(result.payment).toBeNull();
    expect(paymentsService.startCodPaymentForOrder).not.toHaveBeenCalled();
    expect(paymentsService.startPaymentForOrder).not.toHaveBeenCalled();
  });
});

describe("reseller.orders.service listOrders", () => {
  const query = { page: 2, limit: 5 };

  beforeEach(() => {
    prisma.order.count.mockResolvedValue(12);
    prisma.order.findMany.mockResolvedValue([{ id: "ord_1" }]);
  });

  it("returns 404 when the user has no reseller profile", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue(null);

    await expect(resellerOrders.listOrders(user, query)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("lists only the logged-in reseller's own orders", async () => {
    await resellerOrders.listOrders(user, query);

    expect(prisma.order.count.mock.calls[0][0].where).toEqual({ resellerId: "rp_1" });
    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
      resellerId: "rp_1",
    });
  });

  it("paginates and returns the total", async () => {
    const result = await resellerOrders.listOrders(user, query);

    const args = prisma.order.findMany.mock.calls[0][0];
    expect(args.skip).toBe(5);
    expect(args.take).toBe(5);
    expect(result).toEqual({
      items: [{ id: "ord_1" }],
      page: 2,
      limit: 5,
      total: 12,
    });
  });

  it("does not select seller or payment details", async () => {
    await resellerOrders.listOrders(user, query);

    const select = prisma.order.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("sellerOrders");
    expect(select).not.toHaveProperty("payments");
    expect(select).not.toHaveProperty("userId");
    expect(select.resellerMarginTotal).toBe(true);
  });
});

describe("reseller.validation createOrderBody", () => {
  const valid = () => ({
    items: [{ variantId: "var_1", quantity: 2, margin: "10" }],
    customer: customer(),
  });

  it("accepts a valid body and defaults the payment method to ONLINE", () => {
    const result = validation.createOrderBody.safeParse(valid());

    expect(result.success).toBe(true);
    expect(result.data.paymentMethod).toBe("ONLINE");
  });

  it("coerces quantity and margin", () => {
    const result = validation.createOrderBody.safeParse({
      ...valid(),
      items: [{ variantId: "var_1", quantity: "3", margin: 10.5 }],
    });

    expect(result.success).toBe(true);
    expect(result.data.items[0]).toEqual({
      variantId: "var_1",
      quantity: 3,
      margin: "10.5",
    });
  });

  it("accepts COD and an optional share code and second address line", () => {
    const result = validation.createOrderBody.safeParse({
      ...valid(),
      customer: customer({ addressLine2: "Near Bus Stand" }),
      paymentMethod: "COD",
      shareCode: "abc123",
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["no items", { items: [] }],
    ["missing items", { items: undefined }],
    ["missing customer", { customer: undefined }],
    ["unknown payment method", { paymentMethod: "CASH" }],
    ["unknown top-level key such as totalAmount", { totalAmount: 1 }],
    ["empty share code", { shareCode: "" }],
    ["share code over 32 characters", { shareCode: "x".repeat(33) }],
  ])("rejects %s", (_name, override) => {
    const result = validation.createOrderBody.safeParse({ ...valid(), ...override });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 items", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      variantId: `var_${i}`,
      quantity: 1,
      margin: "0",
    }));

    expect(validation.createOrderBody.safeParse({ ...valid(), items }).success).toBe(false);
  });

  it("rejects the same variant listed twice", () => {
    const result = validation.createOrderBody.safeParse({
      ...valid(),
      items: [
        { variantId: "var_1", quantity: 1, margin: "0" },
        { variantId: "var_1", quantity: 2, margin: "0" },
      ],
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["negative margin", { margin: "-5" }],
    ["too many decimals", { margin: "10.123" }],
    ["text margin", { margin: "abc" }],
    ["zero quantity", { quantity: 0 }],
    ["quantity above 100", { quantity: 101 }],
    ["fractional quantity", { quantity: 1.5 }],
    ["empty variant id", { variantId: "" }],
    ["a client-sent price", { unitPrice: "1" }],
  ])("rejects an item with %s", (_name, override) => {
    const result = validation.createOrderBody.safeParse({
      ...valid(),
      items: [{ variantId: "var_1", quantity: 1, margin: "10", ...override }],
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["short name", { name: "A" }],
    ["invalid phone", { phone: "12345" }],
    ["phone starting with 5", { phone: "5876543210" }],
    ["short address", { addressLine1: "abc" }],
    ["missing city", { city: "" }],
    ["missing state", { state: "" }],
    ["5 digit PIN code", { postalCode: "68000" }],
    ["PIN code with letters", { postalCode: "68A001" }],
    ["unknown customer key", { country: "India" }],
  ])("rejects a customer with %s", (_name, override) => {
    const result = validation.createOrderBody.safeParse({
      ...valid(),
      customer: customer(override),
    });

    expect(result.success).toBe(false);
  });
});

describe("reseller.validation listOrdersQuery", () => {
  it("defaults to page 1 with 20 items", () => {
    const result = validation.listOrdersQuery.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ page: 1, limit: 20 });
  });

  it("coerces query strings to numbers", () => {
    const result = validation.listOrdersQuery.safeParse({ page: "2", limit: "10" });

    expect(result.data).toEqual({ page: 2, limit: 10 });
  });

  it.each([
    ["page 0", { page: 0 }],
    ["limit 0", { limit: 0 }],
    ["limit above 50", { limit: 51 }],
  ])("rejects %s", (_name, query) => {
    expect(validation.listOrdersQuery.safeParse(query).success).toBe(false);
  });
});