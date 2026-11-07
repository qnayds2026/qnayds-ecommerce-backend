jest.mock("../src/config/db", () => {
  const { createFakePrisma } = require("./helpers/fakePrisma");
  const prisma = createFakePrisma();

  prisma.order = {
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
  };

  return { prisma, connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../src/config/db");
const app = require("../server");

const SALES_REPORT = "/api/v1/admin/reports/sales";

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

describe("GET /api/v1/admin/reports/sales", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();

    prisma.order.count.mockResolvedValue(3);

    prisma.order.aggregate.mockResolvedValue({
      _sum: { totalAmount: 4500 },
    });

    prisma.order.groupBy.mockResolvedValue([
      {
        status: "CONFIRMED",
        _count: { _all: 2 },
      },
      {
        status: "DELIVERED",
        _count: { _all: 1 },
      },
    ]);

    prisma.order.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-01-10T10:00:00.000Z"),
        totalAmount: 1500,
        status: "CONFIRMED",
        currency: "INR",
      },
    ]);
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get(SALES_REPORT);

    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses the report", async () => {
    await createUser("CUSTOMER");
    const token = createToken("CUSTOMER");

    const res = await request(app)
      .get(SALES_REPORT)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 when a SELLER accesses the report", async () => {
    await createUser("SELLER");
    const token = createToken("SELLER");

    const res = await request(app)
      .get(SALES_REPORT)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows ADMIN to access the sales report", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(SALES_REPORT)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary.totalOrders).toBe(3);
    expect(Number(res.body.data.summary.orderValue)).toBe(4500);
    expect(res.body.data.statusSummary).toHaveLength(2);
    expect(res.body.data.dailyOrders).toHaveLength(1);
  });

  it("supports startDate and endDate filters", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(
        `${SALES_REPORT}?startDate=2026-01-01&endDate=2026-01-31`
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);

    expect(prisma.order.count).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date("2026-01-01"),
          lte: new Date("2026-01-31"),
        },
      },
    });
  });

  it("rejects an invalid date range", async () => {
    await createUser("ADMIN");
    const token = createToken("ADMIN");

    const res = await request(app)
      .get(
        `${SALES_REPORT}?startDate=2026-02-01&endDate=2026-01-01`
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});