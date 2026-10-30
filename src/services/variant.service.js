const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");
const { assertCanManageProduct } = require("./ownership.service");

async function createVariant(user, productId, data) {
  await assertCanManageProduct(user, productId);
  const { initialStock, ...variantData } = data;

  // Variant-um inventory-um oru transaction-il (nested create)
  return prisma.productVariant.create({
    data: {
      ...variantData,
      productId,
      inventory: {
        create: { quantityAvailable: initialStock, quantityReserved: 0 },
      },
    },
    include: { inventory: true },
  });
}

async function updateVariant(user, id, data) {
  const variant = await prisma.productVariant.findUnique({ where: { id } });
  if (!variant) throw ApiError.notFound("Variant not found");
  await assertCanManageProduct(user, variant.productId);

  if (data.price || data.compareAtPrice !== undefined) {
    const price = parseFloat(data.price ?? variant.price.toString());
    const cmp = data.compareAtPrice ?? variant.compareAtPrice?.toString();
    if (cmp && parseFloat(cmp) < price)
      throw ApiError.badRequest("compareAtPrice must be >= price");
  }

  return prisma.productVariant.update({
    where: { id },
    data,
    include: { inventory: true },
  });
}

module.exports = { createVariant, updateVariant };