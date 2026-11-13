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

// Admin: list users with pagination, optional role filter and name/email search.
// passwordHash is never returned because safeUserSelect does not include it.
const listUsers = async (query) => {
  // Convert here too, so it works even if validation does not replace req.query
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const { role, search } = query;

  const where = {};
  if (role) where.role = role;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: safeUserSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

module.exports = { updateProfile, listUsers };