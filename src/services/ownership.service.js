const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");

async function getSellerByUser(userId) {
  return prisma.sellerProfile.findUnique({ where: { userId } });
}

async function getApprovedSeller(userId) {
  const seller = await getSellerByUser(userId);
  if (!seller) throw ApiError.forbidden("Seller profile required");
  if (seller.status !== "APPROVED")
    throw ApiError.forbidden("Seller is not approved");
  return seller;
}

// Owner seller allenkil admin maathram
async function assertCanManageProduct(user, productId) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw ApiError.notFound("Product not found");
  if (user.role === "ADMIN") return product;

  const seller = await getSellerByUser(user.id);
  if (!seller || seller.id !== product.sellerId)
    throw ApiError.forbidden("You do not own this product");
  return product;
}

module.exports = { getSellerByUser, getApprovedSeller, assertCanManageProduct };