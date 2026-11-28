
jest.mock("../src/config/db", () => ({
  prisma: {
    resellerProfile: {
      findUnique: jest.fn(),
    },
    productVariant: {
      findFirst: jest.fn(),
    },
  },
}));

const { prisma } = require("../src/config/db");
const resellerService = require("../src/modules/reseller/reseller.service");

const user = {
  id: "user_1",
  role: "CUSTOMER",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("reseller.service quoteMargin", () => {
  const variant = {
    id: "variant_1",
    name: "Small",
    price: 1000,
    inventory: {
      quantityAvailable: 10,
      quantityReserved: 0,
    },
    product: {
      id: "product_1",
      name: "Test Product",
    },
  };

  beforeEach(() => {
    prisma.resellerProfile.findUnique.mockResolvedValue({
      id: "rp_1",
      status: "APPROVED",
    });

    prisma.productVariant.findFirst.mockResolvedValue(variant);
  });

  it("calculates customer total correctly", async () => {
    const result = await resellerService.quoteMargin(user, {
      variantId: "variant_1",
      quantity: 2,
      margin: 100,
    });

    expect(result.itemsTotal).toBe("2000.00");
    expect(result.marginTotal).toBe("200.00");
    expect(result.customerTotal).toBe("2200.00");
  });

  it("rejects reseller who is not approved", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue({
      id: "rp_1",
      status: "PENDING",
    });

    await expect(
      resellerService.quoteMargin(user, {
        variantId: "variant_1",
        quantity: 1,
        margin: 100,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("rejects unavailable product variant", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(null);

    await expect(
      resellerService.quoteMargin(user, {
        variantId: "invalid_variant",
        quantity: 1,
        margin: 100,
      })
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejects order quantity greater than available stock", async () => {
    prisma.productVariant.findFirst.mockResolvedValue({
      ...variant,
      inventory: {
        quantityAvailable: 2,
        quantityReserved: 1,
      },
    });

    await expect(
      resellerService.quoteMargin(user, {
        variantId: "variant_1",
        quantity: 2,
        margin: 100,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("rejects margin above the allowed limit", async () => {
    await expect(
      resellerService.quoteMargin(user, {
        variantId: "variant_1",
        quantity: 1,
        margin: 600,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
