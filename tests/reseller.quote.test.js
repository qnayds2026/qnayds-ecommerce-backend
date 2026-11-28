jest.mock("../src/config/db", () => ({
  prisma: {
    resellerProfile: { findUnique: jest.fn() },
    productVariant: { findFirst: jest.fn() },
  },
}));

const { prisma } = require("../src/config/db");
const resellerService = require("../src/modules/reseller/reseller.service");
const validation = require("../src/modules/reseller/reseller.validation");

const user = { id: "user_1", role: "CUSTOMER" };
const ORIGINAL_ENV = { ...process.env };

const variant = (overrides = {}) => ({
  id: "var_1",
  name: "bb",
  price: "100",
  inventory: { quantityAvailable: 5 },
  product: { id: "prod_1", name: "Speaker" },
  ...overrides,
});

const body = (overrides = {}) => ({
  variantId: "var_1",
  quantity: 1,
  margin: "10",
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  process.env.RESELLER_SHIPPING_CHARGE = "50";
  process.env.RESELLER_MAX_MARGIN_PERCENT = "50";
  prisma.resellerProfile.findUnique.mockResolvedValue({
    id: "rp_1",
    status: "APPROVED",
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("reseller.service quoteMargin", () => {
  it("returns 403 for a reseller who is not approved", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue({
      id: "rp_1",
      status: "PENDING",
    });

    await expect(resellerService.quoteMargin(user, body())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prisma.productVariant.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the variant is not eligible", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(null);

    await expect(resellerService.quoteMargin(user, body())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("looks the variant up with the eligibility rule", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    await resellerService.quoteMargin(user, body());

    const where = prisma.productVariant.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe("var_1");
    expect(where.isActive).toBe(true);
    expect(where.product).toEqual({ status: "ACTIVE", isResellable: true });
  });

  it("returns 409 when stock is lower than the quantity", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    await expect(
      resellerService.quoteMargin(user, body({ quantity: 6 }))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("adds price, shipping and margin exactly", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant({ price: "99.99" }));

    const result = await resellerService.quoteMargin(
      user,
      body({ quantity: 3, margin: "10.10" })
    );

    expect(result.itemsTotal).toBe("299.97");
    expect(result.marginTotal).toBe("30.30");
    expect(result.shippingCharge).toBe("50.00");
    expect(result.customerTotal).toBe("380.27");
  });

  it("charges shipping once per order, not per unit", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    const result = await resellerService.quoteMargin(
      user,
      body({ quantity: 4, margin: "0" })
    );

    expect(result.shippingCharge).toBe("50.00");
    expect(result.customerTotal).toBe("450.00");
  });

  it("accepts a zero margin", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    const result = await resellerService.quoteMargin(user, body({ margin: "0" }));

    expect(result.marginTotal).toBe("0.00");
    expect(result.customerTotal).toBe("150.00");
  });

  it("accepts a margin equal to the maximum", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    const result = await resellerService.quoteMargin(user, body({ margin: "50" }));

    expect(result.maxMarginPerUnit).toBe("50.00");
    expect(result.customerTotal).toBe("200.00");
  });

  it("rejects a margin above the maximum with 400", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    await expect(
      resellerService.quoteMargin(user, body({ margin: "50.01" }))
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("uses the shipping charge from the server config", async () => {
    process.env.RESELLER_SHIPPING_CHARGE = "80";
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    const result = await resellerService.quoteMargin(user, body({ margin: "0" }));

    expect(result.shippingCharge).toBe("80.00");
    expect(result.customerTotal).toBe("180.00");
  });

  it("falls back to free shipping when the config is missing", async () => {
    delete process.env.RESELLER_SHIPPING_CHARGE;
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    const result = await resellerService.quoteMargin(user, body({ margin: "0" }));

    expect(result.shippingCharge).toBe("0.00");
  });

  it("does not expose stock or seller details", async () => {
    prisma.productVariant.findFirst.mockResolvedValue(variant());

    const result = await resellerService.quoteMargin(user, body());

    expect(result).not.toHaveProperty("inventory");
    expect(result).not.toHaveProperty("quantityAvailable");
    expect(result.product).toEqual({ id: "prod_1", name: "Speaker" });
  });
});

describe("reseller.validation quoteBody", () => {
  it("accepts a valid body and coerces the quantity", () => {
    const result = validation.quoteBody.safeParse({
      variantId: "var_1",
      quantity: "2",
      margin: 10.5,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ variantId: "var_1", quantity: 2, margin: "10.5" });
  });

  it.each([
    ["negative margin", { margin: "-5" }],
    ["too many decimals", { margin: "10.123" }],
    ["text margin", { margin: "abc" }],
    ["missing margin", { margin: undefined }],
    ["zero quantity", { quantity: 0 }],
    ["fractional quantity", { quantity: 1.5 }],
    ["quantity above 100", { quantity: 101 }],
    ["empty variant id", { variantId: "" }],
    ["unknown key such as total", { total: "1" }],
  ])("rejects %s", (_name, override) => {
    const result = validation.quoteBody.safeParse({
      variantId: "var_1",
      quantity: 1,
      margin: "10",
      ...override,
    });
    expect(result.success).toBe(false);
  });
});