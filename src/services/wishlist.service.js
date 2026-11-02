const { prisma } = require('../config/db');
const ApiError = require('../utils/ApiError');

const productSelect = {
  id: true,
  name: true,
  status: true,
  images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
  variants: { where: { isActive: true }, select: { price: true }, orderBy: { price: 'asc' }, take: 1 },
};

const toView = (w) => ({
  id: w.id,
  addedAt: w.createdAt,
  product: {
    id: w.product.id,
    name: w.product.name,
    image: w.product.images?.[0]?.url ?? null,
    // Informational only: wishlist does not guarantee price/availability.
    startingPrice: w.product.variants?.[0] ? Number(w.product.variants[0].price) : null,
    available: w.product.status === 'ACTIVE' && w.product.variants.length > 0,
  },
});

async function list(userId) {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId },
    include: { product: { select: productSelect } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}

async function add(userId, productId) {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!product) throw new ApiError(404, 'Product not found', { code: 'PRODUCT_NOT_FOUND' });
  // Unique (userId, productId) makes this idempotent and race-safe: no duplicates.
  const row = await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    update: {},
    create: { userId, productId },
    include: { product: { select: productSelect } },
  });
  return toView(row);
}

async function remove(userId, productId) {
  const { count } = await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  if (count === 0) throw new ApiError(404, 'Wishlist item not found', { code: 'WISHLIST_ITEM_NOT_FOUND' });
}

module.exports = { list, add, remove };