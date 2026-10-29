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

module.exports = {
  updateProfileSchema,
};