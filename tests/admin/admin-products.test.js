jest.mock("../../src/config/db", () => {
  const { createFakePrisma } = require("../helpers/fakePrisma");
  const prisma = createFakePrisma();

  prisma.product = {
    findMany: jest.fn().mockResolvedValue([
      {
        id: "product-1",
        name: "Test Product",
        status: "ACTIVE",
        sellerId: "seller-1",
        categoryId: "category-1",
      },
    ]),
    count: jest.fn().mockResolvedValue(1),
  };

  return { prisma, connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../src/config/db");
const app = require("../../server");

const PRODUCTS = "/api/v1/admin/products";

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

describe("GET /api/v1/admin/products", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();

    prisma.product.findMany.mockResolvedValue([
      {
        id: "product-1",
        name: "Test Product",
        status: "ACTIVE",
        sellerId: "seller-1",
        categoryId: "category-1",
      },
    ]);
    prisma.product.count.mockResolvedValue(1);
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get(PRODUCTS);

    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses the product list", async () => {
    await createUser("CUSTOMER");

    const token = createToken("CUSTOMER");
    const res = await request(app)
      .get(PRODUCTS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 when a SELLER accesses the product list", async () => {
    await createUser("SELLER");

    const token = createToken("SELLER");
    const res = await request(app)
      .get(PRODUCTS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows an ADMIN to access the product list", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");
    const res = await request(app)
      .get(PRODUCTS)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it("supports product filters, search and pagination", async () => {
    await createUser("ADMIN");

    const token = createToken("ADMIN");
    const res = await request(app)
      .get(
        `${PRODUCTS}?page=2&limit=5&status=ACTIVE&categoryId=category-1&sellerId=seller-1&search=test`
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        where: expect.objectContaining({
          status: "ACTIVE",
          categoryId: "category-1",
          sellerId: "seller-1",
          OR: expect.any(Array),
        }),
      })
    );
  });
});
