jest.mock("../../src/config/db", () => {
  const { createFakePrisma } = require("../helpers/fakePrisma");
  const prisma = createFakePrisma();
  prisma.user.count = jest.fn().mockResolvedValue(0);

  prisma.sellerProfile = {
    count: jest.fn().mockResolvedValue(0),
  };

  prisma.product = {
    count: jest.fn().mockResolvedValue(0),
  };

  prisma.order = {
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 0 } }),
    findMany: jest.fn().mockResolvedValue([]),
  };

  return { prisma, connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../src/config/db");
const app = require("../../server");

const DASHBOARD = "/api/v1/admin/dashboard";

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

describe("GET /api/v1/admin/dashboard", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get(DASHBOARD);

    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses the dashboard", async () => {
    await createUser("CUSTOMER");

    const token = createToken("CUSTOMER");
    const res = await request(app)
      .get(DASHBOARD)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("does not allow a SELLER to access the dashboard", async () => {
    await createUser("SELLER");

    const token = createToken("SELLER");
    const res = await request(app)
      .get(DASHBOARD)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows an ADMIN to access the dashboard", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");
    const res = await request(app)
      .get(DASHBOARD)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metrics).toBeDefined();
  });

    it("applies the date range filter when valid dates are provided", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");

    const startDate = "2026-11-01T00:00:00.000Z";
    const endDate = "2026-11-04T23:59:59.999Z";

    const res = await request(app)
      .get(DASHBOARD)
      .query({ startDate, endDate })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);

    const expectedDateFilter = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    expect(prisma.order.count).toHaveBeenCalledWith({
      where: expectedDateFilter,
    });

    expect(prisma.order.aggregate).toHaveBeenCalledWith({
      where: {
        ...expectedDateFilter,
        status: {
          notIn: ["CANCELLED", "REFUNDED"],
        },
      },
      _sum: {
        totalAmount: true,
      },
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedDateFilter,
      })
    );
  });

  it("returns 400 when startDate is after endDate", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");

    const res = await request(app)
      .get(DASHBOARD)
      .query({
        startDate: "2026-11-04T00:00:00.000Z",
        endDate: "2026-11-01T00:00:00.000Z",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("returns 400 when date values do not contain a timezone", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");

    const res = await request(app)
      .get(DASHBOARD)
      .query({
        startDate: "2026-11-01",
        endDate: "2026-11-04",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

