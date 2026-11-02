jest.mock("../src/config/db", () => {
  const m = {
    user: { findUnique: jest.fn() },
    productVariant: { findUnique: jest.fn() },
    cart: { upsert: jest.fn(), findUnique: jest.fn() },
    cartItem: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  m.$transaction = (fn) => fn(m); // plain function so resetAllMocks keeps it
  return { prisma: m, connectDatabase: jest.fn() };
});

const request = require("supertest");
const { prisma } = require("../src/config/db");
const app = require("../server");
const { cid, USER_A, bearerFor, mockAuthenticatedUsers } = require("./helpers/mockAuth");

const CART = "/api/v1/cart";
const VARIANT_ID = cid("variant1");
const ITEM_ID = cid("item1");
const CART_ID = cid("cart1");

const variantFixture = (over = {}) => ({
  id: VARIANT_ID,
  isActive: true,
  price: "500.00",
  sku: "KRT-M",
  name: "M",
  inventory: { quantityAvailable: 10, quantityReserved: 4 }, // sellable = 6
  product: { id: cid("product1"), name: "Kurta", status: "ACTIVE", images: [] },
  ...over,
});

const auth = () => ({ Authorization: bearerFor(USER_A) });

beforeEach(() => {
  jest.resetAllMocks();
  mockAuthenticatedUsers(prisma);
  prisma.cart.upsert.mockResolvedValue({ id: CART_ID, userId: USER_A });
  prisma.cart.findUnique.mockResolvedValue({ id: CART_ID, items: [] });
  prisma.cartItem.findUnique.mockResolvedValue(null);
});

describe("authentication", () => {
  it.each([
    ["get", CART],
    ["post", `${CART}/items`],
    ["patch", `${CART}/items/${ITEM_ID}`],
    ["delete", `${CART}/items/${ITEM_ID}`],
    ["delete", CART],
  ])("%s %s without a token returns 401", async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });
});

describe("GET /cart", () => {
  it("computes totals from database prices", async () => {
    prisma.cart.findUnique.mockResolvedValue({
      id: CART_ID,
      items: [{ id: ITEM_ID, quantity: 2, variant: variantFixture() }],
    });
    const res = await request(app).get(CART).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.subtotal).toBe(1000);
    expect(res.body.data.items[0]).toMatchObject({ unitPrice: 500, lineTotal: 1000, availableStock: 6 });
  });

  it("flags stale items (inactive product) and excludes them from the subtotal", async () => {
    prisma.cart.findUnique.mockResolvedValue({
      id: CART_ID,
      items: [
        {
          id: ITEM_ID,
          quantity: 1,
          variant: variantFixture({ product: { id: cid("p2"), name: "Old", status: "ARCHIVED", images: [] } }),
        },
      ],
    });
    const res = await request(app).get(CART).set(auth());
    expect(res.body.data.hasIssues).toBe(true);
    expect(res.body.data.items[0].issues).toContain("UNAVAILABLE");
    expect(res.body.data.subtotal).toBe(0);
  });

  it("creates/looks up the cart for the authenticated user only", async () => {
    await request(app).get(CART).set(auth());
    expect(prisma.cart.upsert.mock.calls[0][0].where).toEqual({ userId: USER_A });
  });
});

describe("POST /cart/items", () => {
  const add = (body) => request(app).post(`${CART}/items`).set(auth()).send(body);

  it.each([0, -1, 1.5, "2"])("rejects quantity %p with 400", async (quantity) => {
    const res = await add({ variantId: VARIANT_ID, quantity });
    expect(res.status).toBe(400);
    expect(prisma.productVariant.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid variantId", async () => {
    const res = await add({ variantId: "abc", quantity: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects client-supplied price, userId and cartId", async () => {
    expect((await add({ variantId: VARIANT_ID, quantity: 1, price: 1 })).status).toBe(400);
    expect((await add({ variantId: VARIANT_ID, quantity: 1, userId: "x" })).status).toBe(400);
    expect((await add({ variantId: VARIANT_ID, quantity: 1, cartId: "x" })).status).toBe(400);
  });

  it("404 when the variant does not exist", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(null);
    const res = await add({ variantId: VARIANT_ID, quantity: 1 });
    expect(res.status).toBe(404);
    expect(res.body.errors.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("409 for an inactive variant", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantFixture({ isActive: false }));
    const res = await add({ variantId: VARIANT_ID, quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.errors.code).toBe("VARIANT_INACTIVE");
  });

  it("409 for a non-ACTIVE product", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(
      variantFixture({ product: { id: cid("p3"), name: "Draft", status: "DRAFT", images: [] } })
    );
    const res = await add({ variantId: VARIANT_ID, quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.errors.code).toBe("PRODUCT_INACTIVE");
  });

  it("409 when quantity exceeds stock minus reserved", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantFixture()); // sellable = 6
    const res = await add({ variantId: VARIANT_ID, quantity: 7 });
    expect(res.status).toBe(409);
    expect(res.body.errors.code).toBe("INSUFFICIENT_STOCK");
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it("counts what is already in the cart against stock", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantFixture());
    prisma.cartItem.findUnique.mockResolvedValue({ id: ITEM_ID, quantity: 5 });
    const res = await add({ variantId: VARIANT_ID, quantity: 2 }); // 5 + 2 > 6
    expect(res.status).toBe(409);
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  it("adds a new item (201) for the authenticated user's cart", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantFixture());
    prisma.cart.findUnique.mockResolvedValue({
      id: CART_ID,
      items: [{ id: ITEM_ID, quantity: 2, variant: variantFixture() }],
    });
    const res = await add({ variantId: VARIANT_ID, quantity: 2 });
    expect(res.status).toBe(201);
    expect(prisma.cartItem.create).toHaveBeenCalledWith({
      data: { cartId: CART_ID, variantId: VARIANT_ID, quantity: 2 },
    });
    expect(res.body.data.subtotal).toBe(1000);
  });

  it("increments quantity when the variant is already in the cart", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantFixture());
    prisma.cartItem.findUnique.mockResolvedValue({ id: ITEM_ID, quantity: 1 });
    const res = await add({ variantId: VARIANT_ID, quantity: 2 });
    expect(res.status).toBe(201);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({ where: { id: ITEM_ID }, data: { quantity: 3 } });
  });
});

describe("PATCH /cart/items/:itemId", () => {
  const patch = (id, body) => request(app).patch(`${CART}/items/${id}`).set(auth()).send(body);

  it("404 for an item that is not in the caller's cart (ownership is in the query)", async () => {
    prisma.cartItem.findFirst.mockResolvedValue(null);
    const res = await patch(ITEM_ID, { quantity: 1 });
    expect(res.status).toBe(404);
    expect(prisma.cartItem.findFirst.mock.calls[0][0].where).toEqual({ id: ITEM_ID, cart: { userId: USER_A } });
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  it.each([0, -3, 2.5])("rejects quantity %p", async (quantity) => {
    expect((await patch(ITEM_ID, { quantity })).status).toBe(400);
  });

  it("rejects an invalid item id", async () => {
    expect((await patch("not-an-id", { quantity: 1 })).status).toBe(400);
  });

  it("409 when the new quantity exceeds available stock", async () => {
    prisma.cartItem.findFirst.mockResolvedValue({ id: ITEM_ID, quantity: 1, variant: variantFixture() });
    const res = await patch(ITEM_ID, { quantity: 7 });
    expect(res.status).toBe(409);
    expect(res.body.errors.code).toBe("INSUFFICIENT_STOCK");
  });

  it("updates the quantity", async () => {
    prisma.cartItem.findFirst.mockResolvedValue({ id: ITEM_ID, quantity: 1, variant: variantFixture() });
    const res = await patch(ITEM_ID, { quantity: 3 });
    expect(res.status).toBe(200);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({ where: { id: ITEM_ID }, data: { quantity: 3 } });
  });
});

describe("DELETE /cart/items/:itemId and DELETE /cart", () => {
  it("404 and scoped delete for an item that is not the caller's", async () => {
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete(`${CART}/items/${ITEM_ID}`).set(auth());
    expect(res.status).toBe(404);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: ITEM_ID, cart: { userId: USER_A } } });
  });

  it("removes an owned item and returns the cart", async () => {
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app).delete(`${CART}/items/${ITEM_ID}`).set(auth());
    expect(res.status).toBe(200);
  });

  it("clears only the caller's cart", async () => {
    prisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });
    const res = await request(app).delete(CART).set(auth());
    expect(res.status).toBe(204);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cart: { userId: USER_A } } });
  });
});