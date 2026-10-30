jest.mock("../src/config/db", () => {
  const m = {
    user: { findUnique: jest.fn() },
    product: { findFirst: jest.fn() },
    wishlistItem: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  };
  m.$transaction = (fn) => fn(m);
  return { prisma: m, connectDatabase: jest.fn() };
});

const request = require("supertest");
const { prisma } = require("../src/config/db");
const app = require("../server");
const { cid, USER_A, bearerFor, mockAuthenticatedUsers } = require("./helpers/mockAuth");

const WISHLIST = "/api/v1/wishlist";
const PRODUCT_ID = cid("product1");
const auth = () => ({ Authorization: bearerFor(USER_A) });

const wishlistRow = () => ({
  id: cid("wish1"),
  createdAt: new Date(),
  product: {
    id: PRODUCT_ID,
    name: "Kurta",
    status: "ACTIVE",
    images: [{ url: "https://img/1.jpg" }],
    variants: [{ price: "499.00" }],
  },
});

beforeEach(() => {
  jest.resetAllMocks();
  mockAuthenticatedUsers(prisma);
});

describe("authentication", () => {
  it.each([
    ["get", WISHLIST],
    ["post", `${WISHLIST}/${PRODUCT_ID}`],
    ["delete", `${WISHLIST}/${PRODUCT_ID}`],
  ])("%s %s without a token returns 401", async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
  });
});

describe("GET /wishlist", () => {
  it("lists only the caller's items", async () => {
    prisma.wishlistItem.findMany.mockResolvedValue([wishlistRow()]);
    const res = await request(app).get(WISHLIST).set(auth());
    expect(res.status).toBe(200);
    expect(prisma.wishlistItem.findMany.mock.calls[0][0].where).toEqual({ userId: USER_A });
    expect(res.body.data[0].product).toMatchObject({ id: PRODUCT_ID, startingPrice: 499, available: true });
  });
});

describe("POST /wishlist/:productId", () => {
  it("rejects an invalid product id", async () => {
    expect((await request(app).post(`${WISHLIST}/bad-id`).set(auth())).status).toBe(400);
  });

  it("404 for a missing or non-ACTIVE product", async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    const res = await request(app).post(`${WISHLIST}/${PRODUCT_ID}`).set(auth());
    expect(res.status).toBe(404);
    expect(prisma.wishlistItem.upsert).not.toHaveBeenCalled();
  });

  it("adds a product for the authenticated user", async () => {
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.wishlistItem.upsert.mockResolvedValue(wishlistRow());
    const res = await request(app).post(`${WISHLIST}/${PRODUCT_ID}`).set(auth());
    expect(res.status).toBe(201);
    const arg = prisma.wishlistItem.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId_productId: { userId: USER_A, productId: PRODUCT_ID } });
    expect(arg.create).toEqual({ userId: USER_A, productId: PRODUCT_ID });
  });

  it("adding the same product twice is idempotent (upsert on the unique pair, no duplicate rows)", async () => {
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.wishlistItem.upsert.mockResolvedValue(wishlistRow());
    const first = await request(app).post(`${WISHLIST}/${PRODUCT_ID}`).set(auth());
    const second = await request(app).post(`${WISHLIST}/${PRODUCT_ID}`).set(auth());
    expect([first.status, second.status]).toEqual([201, 201]);
    const [a, b] = prisma.wishlistItem.upsert.mock.calls;
    expect(a[0].where).toEqual(b[0].where);
    expect(a[0].update).toEqual({});
  });
});

describe("DELETE /wishlist/:productId", () => {
  it("404 when the product is not in the caller's wishlist", async () => {
    prisma.wishlistItem.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete(`${WISHLIST}/${PRODUCT_ID}`).set(auth());
    expect(res.status).toBe(404);
    expect(prisma.wishlistItem.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_A, productId: PRODUCT_ID } });
  });

  it("removes an entry (204)", async () => {
    prisma.wishlistItem.deleteMany.mockResolvedValue({ count: 1 });
    expect((await request(app).delete(`${WISHLIST}/${PRODUCT_ID}`).set(auth())).status).toBe(204);
  });
});