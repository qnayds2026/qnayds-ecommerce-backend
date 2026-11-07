jest.mock("../../src/config/db", () => {
  const { createFakePrisma } = require("../helpers/fakePrisma");
  const prisma = createFakePrisma();

  prisma.order = {
    findUnique: jest.fn(),
  };

  return { prisma, connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../src/config/db");
const app = require("../../server");

const ORDER_DETAILS = "/api/v1/admin/orders/order-1";

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

describe("GET /api/v1/admin/orders/:id", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();

    prisma.order.findUnique.mockResolvedValue({
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
    });
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get(ORDER_DETAILS);

    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses order details", async () => {
    await createUser("CUSTOMER");
    const token = createToken("CUSTOMER");

    const res = await request(app)
      .get(ORDER_DETAILS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 when a SELLER accesses order details", async () => {
    await createUser("SELLER");
    const token = createToken("SELLER");

    const res = await request(app)
      .get(ORDER_DETAILS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows ADMIN to view order details", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(ORDER_DETAILS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orderNumber).toBe("ORD-001");
    expect(res.body.data.user.email).toBe("customer@test.com");
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1" },
        include: expect.any(Object),
      })
    );
  });

  it("returns 404 when the order does not exist", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    prisma.order.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(ORDER_DETAILS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Order not found");
  });
});