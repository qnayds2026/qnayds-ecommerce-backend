const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");
const {
  getApprovedSeller,
  getSellerByUser,
  assertCanManageProduct,
} = require("./ownership.service");

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function assertCategoryActive(categoryId) {
  const cat = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!cat) throw ApiError.badRequest("Category not found");
  if (!cat.isActive) throw ApiError.badRequest("Category is disabled");
}

async function createProduct(user, data) {
  // sellerId client-il ninnalla, login user-inte approved profile-il ninnu
  const seller = await getApprovedSeller(user.id);
  await assertCategoryActive(data.categoryId);

  return prisma.product.create({
    data: {
      sellerId: seller.id,
      categoryId: data.categoryId,
      name: data.name,
      slug: data.slug || slugify(data.name),
      description: data.description,
      brand: data.brand,
      status: "DRAFT",
    },
  });
}

async function listProducts({ page, limit, q, categoryId, brand }) {
  const where = {
    status: "ACTIVE",
    ...(categoryId && { categoryId }),
    ...(brand && { brand: { equals: brand, mode: "insensitive" } }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        variants: {
          where: { isActive: true },
          select: { id: true, price: true },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function getProductById(id) {
  const product = await prisma.product.findFirst({
    where: { id, status: "ACTIVE" },
    include: {
      variants: { where: { isActive: true }, include: { inventory: true } },
      images: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!product) throw ApiError.notFound("Product not found");
  return product;
}


async function updateProduct(user, id, data) {
  const product = await assertCanManageProduct(user, id);

  if (data.categoryId) {
    await assertCategoryActive(data.categoryId);
  }

  // Seller cannot change product moderation status.
  // Only Admin can approve, reject or archive products.
  return prisma.product.update({
    where: { id },
    data,
  });
}

// Hard delete illa, archive maathram (orders reference cheyyaam)
async function archiveProduct(user, id) {
  await assertCanManageProduct(user, id);
  return prisma.product.update({ where: { id }, data: { status: "ARCHIVED" } });
}

// Seller-inte swantham products (drafts ulppede)
async function listMyProducts(user) {
  const seller = await getSellerByUser(user.id);
  if (!seller) throw ApiError.forbidden("Seller profile required");
  return prisma.product.findMany({
    where: { sellerId: seller.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

// Admin: list ALL products (any status, any seller) with pagination.
// Seller and category are loaded with separate queries, so this does not
// depend on relation field names in schema.prisma.
async function adminListProducts({ page, limit, status, q, categoryId }) {
  const where = {
    ...(status && { status }),
    ...(categoryId && { categoryId }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        variants: { select: { id: true, price: true, isActive: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const sellerIds = [...new Set(products.map((p) => p.sellerId))];
  const categoryIds = [...new Set(products.map((p) => p.categoryId))];

  const [sellers, categories] = await Promise.all([
    prisma.sellerProfile.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, shopName: true },
    }),
    prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    }),
  ]);

  const sellerMap = new Map(sellers.map((s) => [s.id, s]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const items = products.map((p) => ({
    ...p,
    seller: sellerMap.get(p.sellerId) || null,
    category: categoryMap.get(p.categoryId) || null,
  }));

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

module.exports = {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  archiveProduct,
  listMyProducts,
  adminListProducts,
};