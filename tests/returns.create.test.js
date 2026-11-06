jest.mock("../src/config/db", () => ({
  prisma: {
    order: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const { prisma } = require("../src/config/db");
const returnsService = require("../src/modules/returns/returns.service");

const user = { id: "user_1", role: "CUSTOMER" };
const DAY_MS = 24 * 60 * 60 * 1000;

const makeOrder = (overrides = {}) => ({
  id: "order_1",
  userId: "user_1",
  currency: "INR",
  orderItems: [
    {
      id: "item_1",
      sellerOrderId: "so_1",
      productName: "Shirt",
      unitPrice: "500.00",
      quantity: 3,
    },
    {
      id: "item_2",
      sellerOrderId: "so_2",
      productName: "Shoes",
      unitPrice: "1200.00",
      quantity: 1,
    },
  ],
  sellerOrders: [
    { id: "so_1", orderId: "order_1", status: "DELIVERED", updatedAt: new Date() },
    { id: "so_2", orderId: "order_1", status: "DELIVERED", updatedAt: new Date() },
  ],
  ...overrides,
});

const body = (overrides = {}) => ({
  orderId: "order_1",
  reason: "DEFECTIVE",
  customerNote: "Stitching came off",
  items: [{ orderItemId: "item_1", quantity: 1 }],
  ...overrides,
});

describe("returns.service createReturn", () => {
  let tx;

  beforeEach(() => {
    jest.clearAllMocks();

    // Happy-path defaults, each test changes only what it needs.
    tx = {
      orderStatusHistory: {
        findFirst: jest.fn().mockResolvedValue({ createdAt: new Date() }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue({ id: "pay_1", status: "CAPTURED" }),
      },
      returnItem: { groupBy: jest.fn().mockResolvedValue([]) },
      returnRequest: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: "ret_1", ...data })),
      },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    prisma.order.findFirst.mockResolvedValue(makeOrder());
  });

  describe("ownership", () => {
    test("someone else's order looks like a missing one (404), no transaction", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(returnsService.createReturn(user, body())).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({
        id: "order_1",
        userId: "user_1",
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test("item that is not part of the order is rejected (400)", async () => {
      await expect(
        returnsService.createReturn(
          user,
          body({ items: [{ orderItemId: "item_other", quantity: 1 }] })
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("eligibility", () => {
    test("items from two sellers in one request are rejected (400)", async () => {
      await expect(
        returnsService.createReturn(
          user,
          body({
            items: [
              { orderItemId: "item_1", quantity: 1 },
              { orderItemId: "item_2", quantity: 1 },
            ],
          })
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    test("items that are not delivered cannot be returned (400)", async () => {
      prisma.order.findFirst.mockResolvedValue(
        makeOrder({
          sellerOrders: [
            { id: "so_1", orderId: "order_1", status: "SHIPPED", updatedAt: new Date() },
            { id: "so_2", orderId: "order_1", status: "DELIVERED", updatedAt: new Date() },
          ],
        })
      );

      await expect(returnsService.createReturn(user, body())).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test("return window over is rejected (400)", async () => {
      tx.orderStatusHistory.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 400 * DAY_MS),
      });

      await expect(returnsService.createReturn(user, body())).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(tx.returnRequest.create).not.toHaveBeenCalled();
    });

    test("order without a captured payment cannot be returned (409)", async () => {
      tx.payment.findFirst.mockResolvedValue(null);

      await expect(returnsService.createReturn(user, body())).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(tx.returnRequest.create).not.toHaveBeenCalled();
    });
  });

  describe("partial quantities and duplicates", () => {
    test("cannot return more than what is still left (409)", async () => {
      // bought 3, 2 already in an active return, asking for 2 more
      tx.returnItem.groupBy.mockResolvedValue([
        { orderItemId: "item_1", _sum: { quantity: 2 } },
      ]);

      await expect(
        returnsService.createReturn(
          user,
          body({ items: [{ orderItemId: "item_1", quantity: 2 }] })
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(tx.returnRequest.create).not.toHaveBeenCalled();
    });

    test("only the remaining quantity can be returned again", async () => {
      tx.returnItem.groupBy.mockResolvedValue([
        { orderItemId: "item_1", _sum: { quantity: 2 } },
      ]);

      const result = await returnsService.createReturn(
        user,
        body({ items: [{ orderItemId: "item_1", quantity: 1 }] })
      );

      expect(result.refundAmount.toNumber()).toBe(500);
    });

    test("duplicate check counts active returns, not rejected or cancelled ones", async () => {
      await returnsService.createReturn(user, body());

      const statuses = tx.returnItem.groupBy.mock.calls[0][0].where.returnRequest.status.in;
      expect(statuses).toContain("REQUESTED");
      expect(statuses).toContain("REFUNDED");
      expect(statuses).not.toContain("REJECTED");
      expect(statuses).not.toContain("CANCELLED");
    });

    test("two requests at the same moment: one fails with 409", async () => {
      prisma.$transaction.mockRejectedValue({ code: "P2034" });

      await expect(returnsService.createReturn(user, body())).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  });

  describe("successful return", () => {
    test("partial return: refund = unit price x quantity, status REQUESTED, audit row created", async () => {
      const result = await returnsService.createReturn(
        user,
        body({ items: [{ orderItemId: "item_1", quantity: 2 }] })
      );

      const data = tx.returnRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe("REQUESTED");
      expect(data.userId).toBe("user_1");
      expect(data.sellerOrderId).toBe("so_1");
      expect(data.paymentId).toBe("pay_1");
      expect(data.items.create).toHaveLength(1);
      expect(data.items.create[0].quantity).toBe(2);
      expect(result.refundAmount.toNumber()).toBe(1000);

      expect(data.history.create).toMatchObject({
        oldStatus: null,
        newStatus: "REQUESTED",
        changedBy: "user_1",
        actorRole: "CUSTOMER",
      });
    });

    test("refund amount is calculated on the server, not taken from the client", async () => {
      const result = await returnsService.createReturn(
        user,
        body({ refundAmount: 99999 })
      );

      expect(result.refundAmount.toNumber()).toBe(500);
    });
  });
});