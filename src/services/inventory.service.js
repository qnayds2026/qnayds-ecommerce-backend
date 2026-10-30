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
      where: { variantId },
      data: { quantityAvailable: available },
    });
  }

  if (result.count === 0)
    throw ApiError.conflict("Insufficient stock or inventory record missing");

  return prisma.inventory.findUnique({ where: { variantId } });
}

module.exports = { updateInventory };