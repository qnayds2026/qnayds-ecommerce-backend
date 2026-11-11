jest.mock("../../src/config/db", () => {
  const { createFakePrisma } = require("../helpers/fakePrisma");
  const prisma = createFakePrisma();

  prisma.category = {
    findMany: jest.fn(),
    count: jest.fn(),
  };

  return { prisma, connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../src/config/db");
const app = require("../../server");

const CATEGORIES = "/api/v1/categories/admin";

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

describe("GET /api/v1/categories/admin", () => {
  beforeEach(() => {
    prisma._reset();
    jest.clearAllMocks();

    prisma.category.findMany.mockResolvedValue([
      {
        id: "category-1",
        name: "Electronics",
        slug: "electronics",
        isActive: true,
      },
    ]);
    prisma.category.count.mockResolvedValue(1);
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get(CATEGORIES);

    expect(res.status).toBe(401);
  });

  it("returns 403 when a CUSTOMER accesses the category list", async () => {
    await createUser("CUSTOMER");

    const res = await request(app)
      .get(CATEGORIES)
      .set("Authorization", `Bearer ${createToken("CUSTOMER")}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 when a SELLER accesses the category list", async () => {
    await createUser("SELLER");

    const res = await request(app)
      .get(CATEGORIES)
      .set("Authorization", `Bearer ${createToken("SELLER")}`);

    expect(res.status).toBe(403);
  });

  it("allows an ADMIN to access all categories", async () => {
    await createUser("ADMIN");

    const res = await request(app)
      .get(CATEGORIES)
      .set("Authorization", `Bearer ${createToken("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.categories).toHaveLength(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it("supports active status filtering and pagination", async () => {
    await createUser("ADMIN");

    const res = await request(app)
      .get(`${CATEGORIES}?page=2&limit=5&isActive=false`)
      .set("Authorization", `Bearer ${createToken("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: false },
        skip: 5,
        take: 5,
      })
    );
  });
});
