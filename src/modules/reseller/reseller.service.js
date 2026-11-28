const crypto = require("crypto");
const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");

// Only these fields are ever returned. Bank details live in a separate
// table and are never part of the profile response.
const profileSelect = {
  id: true,
  displayName: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

const shareSelect = {
  id: true,
  code: true,
  productId: true,
  isActive: true,
  createdAt: true,
  product: { select: { name: true, slug: true } },
};

// Same rule the cart uses (ACTIVE product, active variant) plus the
// reselling flag and available stock.
const sellableVariant = {
  isActive: true,
  inventory: { is: { quantityAvailable: { gt: 0 } } },
};

const eligibleProductWhere = {
  status: "ACTIVE",
  isResellable: true,
  variants: { some: sellableVariant },
};

function generateShareCode() {
  return crypto.randomBytes(5).toString("hex");
}

// Only an approved reseller may browse products or create share links.
async function getApprovedReseller(user) {
  const profile = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!profile) {
    throw ApiError.notFound("Reseller profile not found");
  }
  if (profile.status !== "APPROVED") {
    throw ApiError.forbidden("Your reseller account is not approved");
  }
  return profile;
}

async function createProfile(user, body) {
  const existing = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict("Reseller profile already exists");
  }

  return prisma.resellerProfile.create({
    data: {
      userId: user.id,
      displayName: body.displayName,
      phone: body.phone ?? null,
    },
    select: profileSelect,
  });
}

async function getProfile(user) {
  const profile = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: profileSelect,
  });
  if (!profile) {
    throw ApiError.notFound("Reseller profile not found");
  }
  return profile;
}

async function updateProfile(user, body) {
  const profile = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!profile) {
    throw ApiError.notFound("Reseller profile not found");
  }
  if (profile.status === "SUSPENDED") {
    throw ApiError.forbidden("Your reseller account is suspended");
  }

  return prisma.resellerProfile.update({
    where: { id: profile.id },
    data: body,
    select: profileSelect,
  });
}

async function listProducts(user, query) {
  await getApprovedReseller(user);

  const { page, limit, search } = query;
  const where = {
    ...eligibleProductWhere,
    ...(search && { name: { contains: search, mode: "insensitive" } }),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        slug: true,
        brand: true,
        images: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: { url: true, altText: true },
        },
        variants: {
          where: sellableVariant,
          orderBy: { price: "asc" },
          select: { id: true, name: true, price: true },
        },
      },
    }),
  ]);

  const items = products.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    brand: p.brand,
    image: p.images[0] ?? null,
    minPrice: p.variants[0]?.price ?? null,
    variants: p.variants,
  }));

  return { items, page, limit, total };
}

async function createShare(user, body) {
  const reseller = await getApprovedReseller(user);

  const product = await prisma.product.findFirst({
    where: { id: body.productId, ...eligibleProductWhere },
    select: { id: true },
  });
  if (!product) {
    throw ApiError.notFound("Product not found or not available for reselling");
  }

  const key = {
    resellerId_productId: { resellerId: reseller.id, productId: product.id },
  };

  const existing = await prisma.resellerProductShare.findUnique({
    where: key,
    select: shareSelect,
  });
  if (existing) {
    if (existing.isActive) {
      return { share: existing, created: false };
    }
    const share = await prisma.resellerProductShare.update({
      where: key,
      data: { isActive: true },
      select: shareSelect,
    });
    return { share, created: false };
  }

  try {
    const share = await prisma.resellerProductShare.create({
      data: {
        resellerId: reseller.id,
        productId: product.id,
        code: generateShareCode(),
      },
      select: shareSelect,
    });
    return { share, created: true };
  } catch (err) {
    // Two requests at once: return the share the other request created.
    if (err.code === "P2002") {
      const again = await prisma.resellerProductShare.findUnique({
        where: key,
        select: shareSelect,
      });
      if (again) return { share: again, created: false };
    }
    throw err;
  }
}

async function listShares(user, query) {
  const reseller = await getApprovedReseller(user);

  const { page, limit } = query;
  const where = { resellerId: reseller.id };

  const [total, items] = await Promise.all([
    prisma.resellerProductShare.count({ where }),
    prisma.resellerProductShare.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: shareSelect,
    }),
  ]);

  return { items, page, limit, total };
}

const { Prisma } = require("@prisma/client");

const D = Prisma.Decimal;

// Placeholders until the Team Lead confirms the policy.
function getShippingCharge() {
  const value = Number(process.env.RESELLER_SHIPPING_CHARGE);
  return Number.isFinite(value) && value >= 0 ? new D(value) : new D(0);
}

function getMaxMarginPercent() {
  const value = Number(process.env.RESELLER_MAX_MARGIN_PERCENT);
  return Number.isFinite(value) && value >= 0 ? value : 50;
}

// Every amount comes from the database or server config, never from the client.
// The client only sends the variant, the quantity and its own margin.
async function quoteMargin(user, body) {
  await getApprovedReseller(user);

  const variant = await prisma.productVariant.findFirst({
    where: {
      id: body.variantId,
      isActive: true,
      product: { status: "ACTIVE", isResellable: true },
    },
    select: {
      id: true,
      name: true,
      price: true,
      inventory: { select: { quantityAvailable: true, quantityReserved: true } },
      product: { select: { id: true, name: true } },
    },
  });
  if (!variant) {
    throw ApiError.notFound("Product not found or not available for reselling");
  }

  const available =
    (variant.inventory?.quantityAvailable ?? 0) -
    (variant.inventory?.quantityReserved ?? 0);
  if (available < body.quantity) {
    throw ApiError.conflict("Not enough stock for the requested quantity");
  }

  const unitPrice = new D(variant.price);
  const marginPerUnit = new D(body.margin);
  const maxMarginPerUnit = unitPrice
    .mul(getMaxMarginPercent())
    .div(100)
    .toDecimalPlaces(2, D.ROUND_DOWN);

  if (marginPerUnit.gt(maxMarginPerUnit)) {
    throw ApiError.badRequest(
      `Margin cannot be more than ${maxMarginPerUnit.toFixed(2)} per unit`
    );
  }

  const itemsTotal = unitPrice.mul(body.quantity);
  const marginTotal = marginPerUnit.mul(body.quantity);
  const shippingCharge = getShippingCharge();
  const customerTotal = itemsTotal.add(shippingCharge).add(marginTotal);

  return {
    product: variant.product,
    variant: { id: variant.id, name: variant.name },
    quantity: body.quantity,
    currency: "INR",
    unitPrice: unitPrice.toFixed(2),
    marginPerUnit: marginPerUnit.toFixed(2),
    maxMarginPerUnit: maxMarginPerUnit.toFixed(2),
    itemsTotal: itemsTotal.toFixed(2),
    marginTotal: marginTotal.toFixed(2),
    shippingCharge: shippingCharge.toFixed(2),
    customerTotal: customerTotal.toFixed(2),
  };
}

module.exports = {
  createProfile,
  getProfile,
  updateProfile,
  listProducts,
  createShare,
  listShares,
  quoteMargin,
  getApprovedReseller,
  getShippingCharge,
  getMaxMarginPercent,
};