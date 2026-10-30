const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");

// userId verified login-il ninnu varunnathu, client body-yil ninnalla
async function createSellerProfile(userId, data) {
  const existing = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (existing) throw ApiError.conflict("Seller profile already exists");

  // Duplicate shopName: DB unique constraint (P2002) errorHandler 409 aakki tharum
  return prisma.sellerProfile.create({
    data: {
      userId,
      shopName: data.shopName,
      description: data.description,
      status: "PENDING",
    },
  });
}

async function getMySellerProfile(userId) {
  const profile = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!profile) throw ApiError.notFound("Seller profile not found");
  return profile;
}

// Admin maathram
async function updateSellerStatus(id, status) {
  return prisma.sellerProfile.update({ where: { id }, data: { status } });
}

module.exports = { createSellerProfile, getMySellerProfile, updateSellerStatus };