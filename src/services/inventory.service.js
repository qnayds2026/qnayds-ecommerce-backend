const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");
const { assertCanManageProduct } = require("./ownership.service");

async function updateInventory(user, variantId, { delta, available }) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
  });
  if (!variant) throw ApiError.notFound("Variant not found");
  await assertCanManageProduct(user, variant.productId);

  let result;
  if (delta !== undefined) {
    // Kurakkumbol quantityAvailable >= |delta| ennu DB-il thanne check cheyyum (atomic)
    result = await prisma.inventory.updateMany({
      where: {
        variantId,
        ...(delta < 0 && { quantityAvailable: { gte: -delta } }),
      },
      data: { quantityAvailable: { increment: delta } },
    });
  } else {
    result = await prisma.inventory.updateMany({
  where: {
    variantId,
    quantityReserved: { lte: available },
  },
  data: { quantityAvailable: available },
});
  }

  if (result.count === 0)
    throw ApiError.conflict("Insufficient stock or inventory record missing");

  return prisma.inventory.findUnique({ where: { variantId } });
}

const LOW_STOCK_LIMIT = 5;

// Admin: list inventory of all variants with product and seller names.
// Related data is loaded with separate queries (no relation names needed).
async function adminListInventory({ page = 1, limit = 10, search, lowStock }) {
  const skip = (page - 1) * limit;

  let variantFilterIds;
  if (search) {
    const variants = await prisma.productVariant.findMany({
      where: {
        OR: [
          { sku: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    const products = await prisma.product.findMany({
      where: { name: { contains: search, mode: "insensitive" } },
      select: { id: true },
    });
    const byProduct = await prisma.productVariant.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      select: { id: true },
    });
    variantFilterIds = [...new Set([...variants, ...byProduct].map((v) => v.id))];
  }

  const where = variantFilterIds ? { variantId: { in: variantFilterIds } } : {};

  // Low stock: sellable (available - reserved) <= LOW_STOCK_LIMIT
  let items;
  let total;
  if (lowStock === "true") {
    const all = await prisma.inventory.findMany({ where, orderBy: { updatedAt: "desc" } });
    const low = all.filter((i) => i.quantityAvailable - i.quantityReserved <= LOW_STOCK_LIMIT);
    total = low.length;
    items = low.slice(skip, skip + limit);
  } else {
    [items, total] = await prisma.$transaction([
      prisma.inventory.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take: limit }),
      prisma.inventory.count({ where }),
    ]);
  }

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) } },
    select: { id: true, name: true, sku: true, productId: true },
  });
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(variants.map((v) => v.productId))] } },
    select: { id: true, name: true, sellerId: true },
  });
  const sellers = await prisma.sellerProfile.findMany({
    where: { id: { in: [...new Set(products.map((p) => p.sellerId))] } },
    select: { id: true, shopName: true },
  });

  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const sellerMap = new Map(sellers.map((s) => [s.id, s]));

  return {
    items: items.map((i) => {
      const variant = variantMap.get(i.variantId) || null;
      const product = variant ? productMap.get(variant.productId) || null : null;
      return {
        variantId: i.variantId,
        quantityAvailable: i.quantityAvailable,
        quantityReserved: i.quantityReserved,
        sellable: i.quantityAvailable - i.quantityReserved,
        updatedAt: i.updatedAt,
        variantName: variant?.name || null,
        sku: variant?.sku || null,
        productName: product?.name || null,
        shopName: product ? sellerMap.get(product.sellerId)?.shopName || null : null,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    lowStockLimit: LOW_STOCK_LIMIT,
  };
}

module.exports = { updateInventory, adminListInventory };