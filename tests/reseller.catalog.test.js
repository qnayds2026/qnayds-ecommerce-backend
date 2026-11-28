jest.mock("../src/config/db", () => ({
  prisma: {
    resellerProfile: { findUnique: jest.fn() },
    product: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    resellerProductShare: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const { prisma } = require("../src/config/db");
const resellerService = require("../src/modules/reseller/reseller.service");
const validation = require("../src/modules/reseller/reseller.validation");

const user = { id: "user_1", role: "CUSTOMER" };

const approved = () =>
  prisma.resellerProfile.findUnique.mockResolvedValue({
    id: "rp_1",
    status: "APPROVED",
  });

const share = (overrides = {}) => ({
  id: "share_1",
  code: "9a3f496780",
  productId: "prod_1",
  isActive: true,
  createdAt: new Date(),
  product: { name: "Speaker", slug: "speaker" },
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe("reseller access rule", () => {
  it.each([
    ["listProducts", () => resellerService.listProducts(user, { page: 1, limit: 20 })],
    ["createShare", () => resellerService.createShare(user, { productId: "prod_1" })],
    ["listShares", () => resellerService.listShares(user, { page: 1, limit: 20 })],
  ])("%s returns 403 for a PENDING reseller", async (_name, call) => {
    prisma.resellerProfile.findUnique.mockResolvedValue({
      id: "rp_1",
      status: "PENDING",
    });

    await expect(call()).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.resellerProductShare.create).not.toHaveBeenCalled();
    expect(prisma.resellerProductShare.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the user has no reseller profile", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue(null);

    await expect(
      resellerService.listProducts(user, { page: 1, limit: 20 })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("reseller.service listProducts", () => {
  it("queries only ACTIVE, resellable products", async () => {
    approved();
    prisma.product.count.mockResolvedValue(0);
    prisma.product.findMany.mockResolvedValue([]);

    await resellerService.listProducts(user, { page: 1, limit: 20 });

    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
    expect(where.isResellable).toBe(true);
    expect(where.variants).toBeDefined();
    expect(prisma.product.count.mock.calls[0][0].where.status).toBe("ACTIVE");
  });

  it("applies pagination and search", async () => {
    approved();
    prisma.product.count.mockResolvedValue(45);
    prisma.product.findMany.mockResolvedValue([]);

    const result = await resellerService.listProducts(user, {
      page: 3,
      limit: 10,
      search: "speaker",
    });

    const arg = prisma.product.findMany.mock.calls[0][0];
    expect(arg.skip).toBe(20);
    expect(arg.take).toBe(10);
    expect(arg.where.name).toEqual({ contains: "speaker", mode: "insensitive" });
    expect(result).toMatchObject({ page: 3, limit: 10, total: 45 });
  });

  it("returns the first image, the lowest price and no seller details", async () => {
    approved();
    prisma.product.count.mockResolvedValue(1);
    prisma.product.findMany.mockResolvedValue([
      {
        id: "prod_1",
        name: "Speaker",
        slug: "speaker",
        brand: "boat",
        images: [{ url: "https://img/1.jpg", altText: null }],
        variants: [
          { id: "v1", name: "small", price: "100" },
          { id: "v2", name: "large", price: "150" },
        ],
      },
    ]);

    const result = await resellerService.listProducts(user, { page: 1, limit: 20 });

    const item = result.items[0];
    expect(item.image).toEqual({ url: "https://img/1.jpg", altText: null });
    expect(item.minPrice).toBe("100");
    expect(item).not.toHaveProperty("sellerId");
    expect(item).not.toHaveProperty("seller");

    const select = prisma.product.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("sellerId");
    expect(select).not.toHaveProperty("seller");
  });

  it("returns a null image and price when there are none", async () => {
    approved();
    prisma.product.count.mockResolvedValue(1);
    prisma.product.findMany.mockResolvedValue([
      { id: "prod_2", name: "X", slug: "x", brand: null, images: [], variants: [] },
    ]);

    const result = await resellerService.listProducts(user, { page: 1, limit: 20 });

    expect(result.items[0].image).toBeNull();
    expect(result.items[0].minPrice).toBeNull();
  });
});

describe("reseller.service createShare", () => {
  it("returns 404 when the product is not eligible", async () => {
    approved();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      resellerService.createShare(user, { productId: "prod_x" })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.resellerProductShare.create).not.toHaveBeenCalled();
  });

  it("checks eligibility with the same rule as the product list", async () => {
    approved();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      resellerService.createShare(user, { productId: "prod_1" })
    ).rejects.toBeDefined();

    const where = prisma.product.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe("prod_1");
    expect(where.status).toBe("ACTIVE");
    expect(where.isResellable).toBe(true);
  });

  it("creates a new share for the logged-in reseller", async () => {
    approved();
    prisma.product.findFirst.mockResolvedValue({ id: "prod_1" });
    prisma.resellerProductShare.findUnique.mockResolvedValue(null);
    prisma.resellerProductShare.create.mockResolvedValue(share());

    const result = await resellerService.createShare(user, { productId: "prod_1" });

    expect(result.created).toBe(true);
    const data = prisma.resellerProductShare.create.mock.calls[0][0].data;
    expect(data.resellerId).toBe("rp_1");
    expect(data.productId).toBe("prod_1");
    expect(data.code).toMatch(/^[0-9a-f]{10}$/);
  });

  it("returns the existing share when called again", async () => {
    approved();
    prisma.product.findFirst.mockResolvedValue({ id: "prod_1" });
    prisma.resellerProductShare.findUnique.mockResolvedValue(share());

    const result = await resellerService.createShare(user, { productId: "prod_1" });

    expect(result.created).toBe(false);
    expect(result.share.code).toBe("9a3f496780");
    expect(prisma.resellerProductShare.create).not.toHaveBeenCalled();
  });

  it("reactivates an inactive share and keeps its code", async () => {
    approved();
    prisma.product.findFirst.mockResolvedValue({ id: "prod_1" });
    prisma.resellerProductShare.findUnique.mockResolvedValue(
      share({ isActive: false })
    );
    prisma.resellerProductShare.update.mockResolvedValue(share());

    const result = await resellerService.createShare(user, { productId: "prod_1" });

    expect(result.created).toBe(false);
    expect(prisma.resellerProductShare.update.mock.calls[0][0].data).toEqual({
      isActive: true,
    });
    expect(prisma.resellerProductShare.create).not.toHaveBeenCalled();
  });

  it("returns the existing share when two requests race (P2002)", async () => {
    approved();
    prisma.product.findFirst.mockResolvedValue({ id: "prod_1" });
    prisma.resellerProductShare.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(share());
    prisma.resellerProductShare.create.mockRejectedValue({ code: "P2002" });

    const result = await resellerService.createShare(user, { productId: "prod_1" });

    expect(result.created).toBe(false);
    expect(result.share.code).toBe("9a3f496780");
  });

  it("rethrows other database errors", async () => {
    approved();
    prisma.product.findFirst.mockResolvedValue({ id: "prod_1" });
    prisma.resellerProductShare.findUnique.mockResolvedValue(null);
    prisma.resellerProductShare.create.mockRejectedValue(new Error("db down"));

    await expect(
      resellerService.createShare(user, { productId: "prod_1" })
    ).rejects.toThrow("db down");
  });
});

describe("reseller.service listShares", () => {
  it("lists only the logged-in reseller's own shares", async () => {
    approved();
    prisma.resellerProductShare.count.mockResolvedValue(1);
    prisma.resellerProductShare.findMany.mockResolvedValue([share()]);

    const result = await resellerService.listShares(user, { page: 1, limit: 20 });

    expect(prisma.resellerProductShare.count.mock.calls[0][0].where).toEqual({
      resellerId: "rp_1",
    });
    expect(prisma.resellerProductShare.findMany.mock.calls[0][0].where).toEqual({
      resellerId: "rp_1",
    });
    expect(result).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(result.items).toHaveLength(1);
  });

  it("does not select resellerId or any bank field", async () => {
    approved();
    prisma.resellerProductShare.count.mockResolvedValue(0);
    prisma.resellerProductShare.findMany.mockResolvedValue([]);

    await resellerService.listShares(user, { page: 1, limit: 20 });

    const select = prisma.resellerProductShare.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("resellerId");
    expect(select).not.toHaveProperty("reseller");
  });
});

describe("reseller.validation (products and shares)", () => {
  it("applies pagination defaults", () => {
    const result = validation.listProductsQuery.parse({});
    expect(result).toMatchObject({ page: 1, limit: 20 });
  });

  it("coerces numeric query strings", () => {
    const result = validation.listSharesQuery.parse({ page: "2", limit: "5" });
    expect(result).toMatchObject({ page: 2, limit: 5 });
  });

  it("rejects limit above 50 and page below 1", () => {
    expect(validation.listProductsQuery.safeParse({ limit: "51" }).success).toBe(false);
    expect(validation.listProductsQuery.safeParse({ page: "0" }).success).toBe(false);
  });

  it("requires a productId and rejects unknown keys", () => {
    expect(validation.createShareBody.safeParse({}).success).toBe(false);
    expect(validation.createShareBody.safeParse({ productId: "" }).success).toBe(false);
    expect(
      validation.createShareBody.safeParse({ productId: "x", extra: 1 }).success
    ).toBe(false);
    expect(validation.createShareBody.safeParse({ productId: "x" }).success).toBe(true);
  });
});