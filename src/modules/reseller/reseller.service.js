const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");

// Only these fields are ever returned. Bank details live in a separate
// table and are never part of the profile response.
const profileSelect = {
  id: true,
  displayName: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

async function createProfile(user, body) {
  const existing = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict("Reseller profile already exists");
  }

  return prisma.resellerProfile.create({
    data: {
      userId: user.id,
      displayName: body.displayName,
      phone: body.phone ?? null,
    },
    select: profileSelect,
  });
}

async function getProfile(user) {
  const profile = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: profileSelect,
  });
  if (!profile) {
    throw ApiError.notFound("Reseller profile not found");
  }
  return profile;
}

async function updateProfile(user, body) {
  const profile = await prisma.resellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!profile) {
    throw ApiError.notFound("Reseller profile not found");
  }
  if (profile.status === "SUSPENDED") {
    throw ApiError.forbidden("Your reseller account is suspended");
  }

  return prisma.resellerProfile.update({
    where: { id: profile.id },
    data: body,
    select: profileSelect,
  });
}

module.exports = { createProfile, getProfile, updateProfile };