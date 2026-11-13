const { z } = require("zod");

// Only these fields may be changed through PATCH /api/v1/users/me.
// .strict() rejects anything else (role, email, passwordHash, id...) with a 400
// instead of silently ignoring it.
const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Name cannot be empty").max(100),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

// Query for GET /api/v1/users (ADMIN only).
// Example: /users?page=1&limit=10&role=SELLER&search=henna
const listUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  role: z.enum(["CUSTOMER", "SELLER", "ADMIN"]).optional(),
  search: z.string().trim().max(100).optional(),
});

module.exports = {
  updateProfileSchema,
  listUsersQuery,
};