jest.mock("../../src/config/db", () => {
  const { createFakePrisma } = require("../helpers/fakePrisma");
  const prisma = createFakePrisma();

  prisma.product = {
    findUnique: jest.fn(),
    update: jest.fn(),
  };

  prisma.productStatusHistory = {
    create: jest.fn(),
  };

  return { prisma, connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../src/config/db");
const app = require("../../server");

const PRODUCT_STATUS_URL =
  "/api/v1/admin/products/product-1/status";

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

describe("PATCH /api/v1/admin/products/:id/status", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();

    prisma.product.findUnique.mockResolvedValue({
      id: "product-1",
      status: "DRAFT",
      seller: {
        status: "APPROVED",
      },
    });

    prisma.product.update.mockResolvedValue({
      id: "product-1",
      status: "ACTIVE",
    });

    prisma.productStatusHistory.create.mockResolvedValue({
      id: "history-1",
    });
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app)
      .patch(PRODUCT_STATUS_URL)
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses the endpoint", async () => {
    await createUser("CUSTOMER");

    const res = await request(app)
      .patch(PRODUCT_STATUS_URL)
      .set("Authorization", `Bearer ${createToken("CUSTOMER")}`)
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when a SELLER accesses the endpoint", async () => {
    await createUser("SELLER");

    const res = await request(app)
      .patch(PRODUCT_STATUS_URL)
      .set("Authorization", `Bearer ${createToken("SELLER")}`)
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(403);
  });

  it("allows ADMIN to activate a product and records moderation history", async () => {
    await createUser("ADMIN");

    const res = await request(app)
      .patch(PRODUCT_STATUS_URL)
      .set("Authorization", `Bearer ${createToken("ADMIN")}`)
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "product-1" },
        data: { status: "ACTIVE" },
      })
    );

    expect(prisma.productStatusHistory.create).toHaveBeenCalledWith({
      data: {
        productId: "product-1",
        adminId: "test-user-id",
        fromStatus: "DRAFT",
        toStatus: "ACTIVE",
        reason: null,
      },
    });
  });

  it("requires a reason when rejecting a product", async () => {
    await createUser("ADMIN");

    const res = await request(app)
      .patch(PRODUCT_STATUS_URL)
      .set("Authorization", `Bearer ${createToken("ADMIN")}`)
      .send({ status: "REJECTED" });

    expect(res.status).toBe(400);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it("rejects invalid product status transitions", async () => {
    await createUser("ADMIN");

    prisma.product.findUnique.mockResolvedValue({
      id: "product-1",
      status: "ACTIVE",
      seller: {
        status: "APPROVED",
      },
    });

    const res = await request(app)
      .patch(PRODUCT_STATUS_URL)
      .set("Authorization", `Bearer ${createToken("ADMIN")}`)
      .send({ status: "REJECTED", reason: "Policy violation" });

    expect(res.status).toBe(400);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it("does not activate products belonging to unapproved sellers", async () => {
    await createUser("ADMIN");

    prisma.product.findUnique.mockResolvedValue({
      id: "product-1",
      status: "DRAFT",
      seller: {
        status: "PENDING",
      },
    });

    const res = await request(app)
      .patch(PRODUCT_STATUS_URL)
      .set("Authorization", `Bearer ${createToken("ADMIN")}`)
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(400);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});