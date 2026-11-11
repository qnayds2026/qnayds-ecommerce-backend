jest.mock("../../src/config/db", () => {
  const { createFakePrisma } = require("../helpers/fakePrisma");
  const prisma = createFakePrisma();

  prisma.order = {
    findMany: jest.fn(),
    count: jest.fn(),
  };

  return { prisma, connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../src/config/db");
const app = require("../../server");

const ORDERS = "/api/v1/admin/orders";

function createToken(role) {
  return jwt.sign(
    { sub: "test-user-id", role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" }
  );
}

async function createUser(role) {
  await prisma.user.create({
    data: {
      id: "test-user-id",
      email: `${role.toLowerCase()}@test.com`,
      role,
    },
  });
}

describe("GET /api/v1/admin/orders", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();

    prisma.order.findMany.mockResolvedValue([
      {
        id: "order-1",
        orderNumber: "ORD-001",
        status: "CONFIRMED",
        totalAmount: 1500,
        currency: "INR",
        user: {
          id: "customer-1",
          name: "Test Customer",
          email: "customer@test.com",
        },
        sellerOrders: [],
        orderItems: [],
        orderStatusHistories: [],
      },
    ]);

    prisma.order.count.mockResolvedValue(1);
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get(ORDERS);
    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses the order list", async () => {
    await createUser("CUSTOMER");
    const token = createToken("CUSTOMER");

    const res = await request(app)
      .get(ORDERS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 when a SELLER accesses the order list", async () => {
    await createUser("SELLER");
    const token = createToken("SELLER");

    const res = await request(app)
      .get(ORDERS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows an ADMIN to access the order list", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(ORDERS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toHaveLength(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it("supports order filters, search and pagination", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(
        `${ORDERS}?page=2&limit=5&status=CONFIRMED&customerId=customer-1&sellerId=seller-1&search=ORD-001&startDate=2026-01-01&endDate=2026-01-31`
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        where: expect.objectContaining({
          status: "CONFIRMED",
          userId: "customer-1",
          sellerOrders: { some: { sellerId: "seller-1" } },
          OR: expect.any(Array),
          createdAt: {
            gte: new Date("2026-01-01"),
            lte: new Date("2026-01-31"),
          },
        }),
      })
    );
  });

  it("rejects an invalid order status", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(`${ORDERS}?status=INVALID_STATUS`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("rejects a date range where startDate is after endDate", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(`${ORDERS}?startDate=2026-02-01&endDate=2026-01-01`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});