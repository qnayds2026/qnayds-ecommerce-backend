jest.mock("../../src/config/db", () => ({
  prisma: {
    order: {
  findFirst: jest.fn(),
},
sellerOrder: {
  findFirst: jest.fn(),
},
    $transaction: jest.fn(),
  },
}));

jest.mock("../../src/services/ownership.service", () => ({
  getSellerByUser: jest.fn(),
}));

jest.mock("../../src/services/cart.service", () => ({
  validateCartForCheckout: jest.fn(),
}));

const {
  createOrder,
  getSellerOrderById,
  cancelCustomerOrder,
} = require("../../src/services/orders.service");

const { prisma } = require("../../src/config/db");
const { validateCartForCheckout } = require("../../src/services/cart.service");
const { getSellerByUser } = require("../../src/services/ownership.service");

describe("Orders Service - createOrder", () => {
  const user = { id: "customer-1" };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should reject when Idempotency-Key is missing", async () => {
    await expect(createOrder(user, {})).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test("should reject when Idempotency-Key is empty", async () => {
    await expect(createOrder(user, {}, "   ")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test("should reject Idempotency-Key longer than 100 characters", async () => {
    await expect(createOrder(user, {}, "a".repeat(101))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test("should return existing order for duplicate Idempotency-Key", async () => {
    const existingOrder = {
      id: "order-1",
      userId: user.id,
      idempotencyKey: "request-123",
    };

    prisma.order.findFirst.mockResolvedValue(existingOrder);

    const result = await createOrder(user, {}, "  request-123  ");

    expect(result).toEqual(existingOrder);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("should create order, seller order, item snapshot and reserve stock", async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    validateCartForCheckout.mockResolvedValue(undefined);

    const createdOrder = { id: "order-1" };
    const createdSellerOrder = { id: "seller-order-1" };
    const finalOrder = { id: "order-1", status: "PENDING_PAYMENT" };

    const tx = {
      cart: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cart-1",
          items: [
            {
              variantId: "variant-1",
              quantity: 2,
              variant: {
                id: "variant-1",
                name: "Large",
                sku: "SKU-001",
                attributes: { size: "Large", color: "Blue" },
                price: "100.50",
                isActive: true,
                inventory: {
                  quantityAvailable: 10,
                  quantityReserved: 2,
                },
                product: {
                  name: "Test Product",
                  sellerId: "seller-1",
                  status: "ACTIVE",
                },
              },
            },
          ],
        }),
      },
      address: {
        findFirst: jest.fn().mockResolvedValue({
          recipientName: "Customer",
          phone: "9999999999",
          addressLine1: "Street",
          addressLine2: null,
          city: "Thrissur",
          state: "Kerala",
          postalCode: "680001",
          country: "India",
        }),
      },
      order: {
        create: jest.fn().mockResolvedValue(createdOrder),
        findUnique: jest.fn().mockResolvedValue(finalOrder),
      },
      sellerOrder: {
        create: jest.fn().mockResolvedValue(createdSellerOrder),
      },
      orderItem: {
        create: jest.fn().mockResolvedValue({}),
      },
      orderStatusHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      cartItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    const result = await createOrder(user, {}, "checkout-123");

    expect(result).toEqual(finalOrder);
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.sellerOrder.create).toHaveBeenCalledTimes(1);
    expect(tx.orderItem.create).toHaveBeenCalledTimes(1);

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.totalAmount.toString()).toBe("201");

    const itemData = tx.orderItem.create.mock.calls[0][0].data;
    expect(itemData.variantAttributes).toEqual({
      size: "Large",
      color: "Blue",
    });
    expect(itemData.unitPrice.toString()).toBe("100.5");
    expect(itemData.quantity).toBe(2);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.cartItem.deleteMany).toHaveBeenCalledTimes(1);
  });
test("should reject checkout when stock reservation fails", async () => {
  prisma.order.findFirst.mockResolvedValue(null);
  validateCartForCheckout.mockResolvedValue(undefined);

  const tx = {
    cart: {
      findUnique: jest.fn().mockResolvedValue({
        id: "cart-1",
        items: [{
          variantId: "variant-1",
          quantity: 2,
          variant: {
            id: "variant-1",
            name: "Large",
            sku: "SKU-001",
            attributes: null,
            price: "100",
            isActive: true,
            inventory: {
              quantityAvailable: 5,
              quantityReserved: 0,
            },
            product: {
              name: "Test Product",
              sellerId: "seller-1",
              status: "ACTIVE",
            },
          },
        }],
      }),
    },
    address: {
      findFirst: jest.fn().mockResolvedValue({
        recipientName: "Customer",
        phone: "9999999999",
        addressLine1: "Street",
        city: "Thrissur",
        state: "Kerala",
        postalCode: "680001",
        country: "India",
      }),
    },
    order: {
      create: jest.fn().mockResolvedValue({ id: "order-1" }),
    },
    sellerOrder: {
      create: jest.fn().mockResolvedValue({ id: "seller-order-1" }),
    },
    orderItem: {
      create: jest.fn().mockResolvedValue({}),
    },
    orderStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    cartItem: {
      deleteMany: jest.fn(),
    },
  };

  prisma.$transaction.mockImplementation(async (callback) => callback(tx));

  await expect(
    createOrder(user, {}, "stock-conflict-123")
  ).rejects.toMatchObject({ statusCode: 409 });

  expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
});
test("should reject checkout when cart is empty", async () => {
  prisma.order.findFirst.mockResolvedValue(null);
  validateCartForCheckout.mockResolvedValue(undefined);

  const tx = {
    cart: {
      findUnique: jest.fn().mockResolvedValue({
        id: "cart-1",
        items: [],
      }),
    },
  };

  prisma.$transaction.mockImplementation(async (callback) => callback(tx));

  await expect(
    createOrder(user, {}, "empty-cart-123")
  ).rejects.toMatchObject({ statusCode: 400 });
});

test("should reject checkout when delivery address is invalid", async () => {
  prisma.order.findFirst.mockResolvedValue(null);
  validateCartForCheckout.mockResolvedValue(undefined);

  const tx = {
    cart: {
      findUnique: jest.fn().mockResolvedValue({
        id: "cart-1",
        items: [{
          variantId: "variant-1",
          quantity: 1,
          variant: {
            id: "variant-1",
            name: "Large",
            sku: "SKU-001",
            price: "100",
            isActive: true,
            inventory: {
              quantityAvailable: 5,
              quantityReserved: 0,
            },
            product: {
              name: "Test Product",
              sellerId: "seller-1",
              status: "ACTIVE",
            },
          },
        }],
      }),
    },
    address: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  prisma.$transaction.mockImplementation(async (callback) => callback(tx));

  await expect(
    createOrder(user, { addressId: "other-user-address" }, "invalid-address-123")
  ).rejects.toMatchObject({ statusCode: 400 });
});
test("should prevent seller from accessing another seller's order", async () => {
  getSellerByUser.mockResolvedValue({ id: "seller-1" });
  prisma.sellerOrder.findFirst.mockResolvedValue(null);

  await expect(
    getSellerOrderById(user, "seller-2-order")
  ).rejects.toMatchObject({
    statusCode: 404,
  });

  expect(prisma.sellerOrder.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: "seller-2-order",
        sellerId: "seller-1",
      },
    })
  );
});
test("should cancel customer order and release reserved stock", async () => {
  const finalOrder = {
    id: "order-1",
    status: "CANCELLED",
  };

  const tx = {
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: "order-1",
        userId: user.id,
        status: "CONFIRMED",
        sellerOrders: [
          {
            id: "seller-order-1",
            status: "CONFIRMED",
          },
        ],
        orderItems: [
          {
            sellerOrderId: "seller-order-1",
            variantId: "variant-1",
            quantity: 2,
          },
        ],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(finalOrder),
    },
    sellerOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    orderStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  prisma.$transaction.mockImplementation(async (callback) => callback(tx));

  const result = await cancelCustomerOrder(
    user,
    "order-1",
    { reason: "Customer requested cancellation" }
  );

  expect(result).toEqual(finalOrder);
  expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
  expect(tx.sellerOrder.updateMany).toHaveBeenCalledTimes(1);
  expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(2);
});
});