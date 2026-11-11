
const { prisma } = require("../config/db");
const ApiError = require("../utils/ApiError");

// Seller registration
async function createSellerProfile(userId, data) {
  const existing = await prisma.sellerProfile.findUnique({
    where: { userId },
  });

  if (existing) {
    throw ApiError.conflict("Seller profile already exists");
  }

  return prisma.sellerProfile.create({
    data: {
      userId,
      shopName: data.shopName,
      description: data.description,
      status: "PENDING",
    },
  });
}

// Seller views own profile
async function getMySellerProfile(userId) {
  const profile = await prisma.sellerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw ApiError.notFound("Seller profile not found");
  }

  return profile;
}

// Admin: list, search, filter and paginate sellers
async function listSellerProfiles(query) {
  const { page, limit, status, search } = query;

  const where = {
    ...(status && { status }),
    ...(search && {
      OR: [
        { shopName: { contains: search, mode: "insensitive" } },
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ],
    }),
  };

  const [sellers, total] = await Promise.all([
    prisma.sellerProfile.findMany({
      where,
      select: {
        id: true,
        shopName: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sellerProfile.count({ where }),
  ]);

  return {
    sellers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// Admin: update seller status, user role and audit history
async function updateSellerStatus(id, status, adminId, reason) {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
    },
  });

  if (!seller) {
    throw ApiError.notFound("Seller profile not found");
  }

  const allowedTransitions = {
    PENDING: ["APPROVED", "REJECTED"],
    APPROVED: ["SUSPENDED"],
    REJECTED: [],
    SUSPENDED: ["APPROVED"],
  };

  if (!allowedTransitions[seller.status]?.includes(status)) {
    throw ApiError.badRequest(
      `Cannot change seller status from ${seller.status} to ${status}`
    );
  }

  if (status === "REJECTED" && !reason?.trim()) {
    throw ApiError.badRequest(
      "Reason is required when rejecting a seller"
    );
  }

  const newRole = status === "APPROVED" ? "SELLER" : "CUSTOMER";

  return prisma.$transaction(async (tx) => {
    const updatedSeller = await tx.sellerProfile.update({
      where: { id },
      data: { status },
    });

    await tx.user.update({
      where: { id: seller.userId },
      data: { role: newRole },
    });

    await tx.sellerStatusHistory.create({
      data: {
        sellerProfileId: id,
        adminId,
        fromStatus: seller.status,
        toStatus: status,
        reason: reason || null,
      },
    });

    return updatedSeller;
  });
}

// Admin: get seller details with status history
async function getSellerProfileById(id) {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      shopName: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      },
      statusHistory: {
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdAt: true,
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!seller) {
    throw ApiError.notFound("Seller not found");
  }

  return seller;
}

module.exports = {
  createSellerProfile,
  getMySellerProfile,
  listSellerProfiles,
  getSellerProfileById,
  updateSellerStatus,
};
