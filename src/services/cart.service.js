const { prisma } = require('../config/db');
const ApiError = require('../utils/ApiError');

const itemInclude = {
  variant: {
    include: {
      inventory: true,
      product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } } },
    },
  },
};

// Single place to change if stock semantics differ (see inventory.service.js).
const availableStock = (inv) => Math.max(0, (inv?.quantityAvailable ?? 0) - (inv?.quantityReserved ?? 0));

// A variant can be bought only if product + variant are live. Returns available stock.
function assertPurchasable(variant) {
  if (!variant || !variant.product) {
    throw new ApiError(404, 'Product is no longer available', { code: 'PRODUCT_NOT_FOUND' });
  }
  if (variant.product.status !== 'ACTIVE') {
    throw new ApiError(409, 'Product is not available for purchase', { code: 'PRODUCT_INACTIVE' });
  }
  if (!variant.isActive) {
    throw new ApiError(409, 'This variant is not available', { code: 'VARIANT_INACTIVE' });
  }
  return availableStock(variant.inventory);
}

function assertStock(available, requested) {
  if (available < requested) {
    throw new ApiError(409, available === 0 ? 'Out of stock' : `Only ${available} unit(s) available`, { code: 'INSUFFICIENT_STOCK' });
  }
}

async function getOrCreateCart(userId, tx = prisma) {
  return tx.cart.upsert({ where: { userId }, update: {}, create: { userId } });
}

// Shape response + compute totals from DB prices only.
function buildCartView(cart) {
  let subtotal = 0;
  const items = cart.items.map((item) => {
    const v = item.variant;
    const p = v.product;
    const available = availableStock(v.inventory);
    const purchasable = p.status === 'ACTIVE' && v.isActive;
    const unitPrice = Number(v.price);
    const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
    if (purchasable && available >= item.quantity) subtotal += lineTotal;
    const issues = [];
    if (!purchasable) issues.push('UNAVAILABLE');
    else if (available < item.quantity) issues.push(available === 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK');
    return {
      id: item.id,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
      availableStock: available,
      issues,
      product: { id: p.id, name: p.name, image: p.images?.[0]?.url ?? null, sellerId: p.sellerId },
      variant: { id: v.id, sku: v.sku, name: v.name },
    };
  });
  return {
    id: cart.id,
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: Number(subtotal.toFixed(2)),
    hasIssues: items.some((i) => i.issues.length > 0),
  };
}

async function fetchCart(userId, tx = prisma) {
  const cart = await getOrCreateCart(userId, tx);
  const full = await tx.cart.findUnique({
    where: { id: cart.id },
    include: { items: { include: itemInclude, orderBy: { createdAt: 'asc' } } },
  });
  return buildCartView(full);
}

async function getCart(userId) {
  return fetchCart(userId);
}

async function addItem(userId, { variantId, quantity }) {
  return prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      include: { inventory: true, product: true },
    });
    const available = assertPurchasable(variant);
    const cart = await getOrCreateCart(userId, tx);
    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });
    const newQty = (existing?.quantity ?? 0) + quantity;
    assertStock(available, newQty);
    if (existing) {
      await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: newQty } });
    } else {
      await tx.cartItem.create({ data: { cartId: cart.id, variantId, quantity } });
    }
    return fetchCart(userId, tx);
  });
}

async function updateItem(userId, itemId, { quantity }) {
  return prisma.$transaction(async (tx) => {
    // Ownership enforced in the query itself.
    const item = await tx.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      include: { variant: { include: { inventory: true, product: true } } },
    });
    if (!item) throw new ApiError(404, 'Cart item not found', { code: 'CART_ITEM_NOT_FOUND' });
    const available = assertPurchasable(item.variant);
    assertStock(available, quantity);
    await tx.cartItem.update({ where: { id: itemId }, data: { quantity } });
    return fetchCart(userId, tx);
  });
}

async function removeItem(userId, itemId) {
  const { count } = await prisma.cartItem.deleteMany({ where: { id: itemId, cart: { userId } } });
  if (count === 0) throw new ApiError(404, 'Cart item not found', { code: 'CART_ITEM_NOT_FOUND' });
  return fetchCart(userId);
}

async function clearCart(userId) {
  await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
}

// For the checkout module: revalidate stale carts. Throws with details if anything is wrong.
async function validateCartForCheckout(userId, tx = prisma) {
  const view = await fetchCart(userId, tx);
  if (view.items.length === 0) throw new ApiError(400, 'Cart is empty', { code: 'CART_EMPTY' });
  if (view.hasIssues) {
    throw new ApiError(409, 'Some cart items are unavailable or out of stock', { code: 'CART_STALE' });
  }
  return view;
}

module.exports = { getCart, addItem, updateItem, removeItem, clearCart, validateCartForCheckout };