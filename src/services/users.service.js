const { prisma } = require("../config/db");

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

// Only fields in this list can ever be changed through the profile endpoint.
// Even if validation changes later, role, email and passwordHash stay safe.
const ALLOWED_FIELDS = ["name"];

const updateProfile = async (userId, data) => {
  const updates = {};
  for (const field of ALLOWED_FIELDS) {
    if (data[field] !== undefined) updates[field] = data[field];
  }

  return prisma.user.update({
    where: { id: userId },
    data: updates,
    select: safeUserSelect,
  });
};

module.exports = { updateProfile };