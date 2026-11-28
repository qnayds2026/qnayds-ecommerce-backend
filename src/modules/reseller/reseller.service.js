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

module.exports = {
  createProfile,
  getProfile,
  updateProfile,
  listProducts,
  createShare,
  listShares,
};