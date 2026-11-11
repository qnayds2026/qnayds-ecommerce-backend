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

// Admin only: list seller applications, optionally filtered by status
async function listSellers(status) {
  return prisma.sellerProfile.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

// Admin only: change seller status and keep User.role in sync (one transaction)
// APPROVED -> SELLER, REJECTED / SUSPENDED -> CUSTOMER
async function updateSellerStatus(id, status) {
  const existing = await prisma.sellerProfile.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Seller profile not found");

  const newRole = status === "APPROVED" ? "SELLER" : "CUSTOMER";

  const [profile] = await prisma.$transaction([
    prisma.sellerProfile.update({
      where: { id },
      data: { status },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.user.update({
      where: { id: existing.userId },
      data: { role: newRole },
    }),
  ]);

  return profile;
}

module.exports = {
  createSellerProfile,
  getMySellerProfile,
  listSellers,
  updateSellerStatus,
};