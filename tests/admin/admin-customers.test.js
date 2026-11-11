
jest.mock("../../src/config/db", () => {
  const { createFakePrisma } = require("../helpers/fakePrisma");
  const prisma = createFakePrisma();

  prisma.user.count = jest.fn().mockResolvedValue(1);
  prisma.user.findMany = jest.fn().mockResolvedValue([
    {
      id: "customer-1",
      name: "Test Customer",
      email: "customer@test.com",
      role: "CUSTOMER",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01"),
    },
  ]);

  prisma.sellerProfile = { count: jest.fn().mockResolvedValue(0) };
  prisma.product = { count: jest.fn().mockResolvedValue(0) };
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

const CUSTOMERS = "/api/v1/admin/customers";

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

describe("GET /api/v1/admin/customers", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();

    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([
      {
        id: "customer-1",
        name: "Test Customer",
        email: "customer@test.com",
        role: "CUSTOMER",
        status: "ACTIVE",
        createdAt: new Date("2026-01-01"),
      },
    ]);
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get(CUSTOMERS);

    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses the customer list", async () => {
    await createUser("CUSTOMER");

    const token = createToken("CUSTOMER");
    const res = await request(app)
      .get(CUSTOMERS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 when a SELLER accesses the customer list", async () => {
    await createUser("SELLER");

    const token = createToken("SELLER");
    const res = await request(app)
      .get(CUSTOMERS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows an ADMIN to access the customer list", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");
    const res = await request(app)
      .get(CUSTOMERS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.customers).toHaveLength(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it("supports search and pagination query parameters", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");
    const res = await request(app)
      .get(`${CUSTOMERS}?page=2&limit=5&search=test`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        where: expect.objectContaining({
          role: "CUSTOMER",
        }),
      })
    );
  });
});

describe("PATCH /api/v1/admin/customers/:id/status", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();
  });

  it("allows an ADMIN to block a customer and records status history", async () => {
    await createUser("ADMIN");

    await prisma.user.create({
      data: {
        id: "customer-1",
        name: "Test Customer",
        email: "customer@test.com",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    });

    const token = createToken("ADMIN");

    const res = await request(app)
      .patch(`${CUSTOMERS}/customer-1/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "BLOCKED",
        reason: "Policy violation",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("BLOCKED");

    expect(prisma._customerStatusHistories).toHaveLength(1);
    expect(prisma._customerStatusHistories[0]).toEqual(
      expect.objectContaining({
        customerId: "customer-1",
        adminId: "test-user-id",
        fromStatus: "ACTIVE",
        toStatus: "BLOCKED",
        reason: "Policy violation",
      })
    );
  });

  it("allows an ADMIN to unblock a customer and records status history", async () => {
    await createUser("ADMIN");

    await prisma.user.create({
      data: {
        id: "customer-2",
        name: "Blocked Customer",
        email: "blocked@test.com",
        role: "CUSTOMER",
        status: "BLOCKED",
      },
    });

    const token = createToken("ADMIN");

    const res = await request(app)
      .patch(`${CUSTOMERS}/customer-2/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "ACTIVE",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");

    expect(prisma._customerStatusHistories).toHaveLength(1);
    expect(prisma._customerStatusHistories[0]).toEqual(
      expect.objectContaining({
        customerId: "customer-2",
        adminId: "test-user-id",
        fromStatus: "BLOCKED",
        toStatus: "ACTIVE",
        reason: null,
      })
    );
  });

  it("rejects blocking a customer without a reason", async () => {
    await createUser("ADMIN");

    await prisma.user.create({
      data: {
        id: "customer-3",
        name: "Test Customer",
        email: "customer3@test.com",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    });

    const token = createToken("ADMIN");

    const res = await request(app)
      .patch(`${CUSTOMERS}/customer-3/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "BLOCKED",
      });

    expect(res.status).toBe(400);
  });
});
