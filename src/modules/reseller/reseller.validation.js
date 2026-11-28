const { z } = require("zod");

const displayName = z
  .string()
  .trim()
  .min(2, { message: "Display name must be at least 2 characters" })
  .max(80, { message: "Display name must be at most 80 characters" });

const phone = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, { message: "Enter a valid 10-digit mobile number" });

// strictObject: unknown fields (for example "status") are rejected.
const createProfileBody = z.strictObject({
  displayName,
  phone: phone.optional(),
});

const updateProfileBody = z
  .strictObject({
    displayName: displayName.optional(),
    phone: phone.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

const listProductsQuery = z.object({
  ...pagination,
  search: z.string().trim().min(1).max(100).optional(),
});

const listSharesQuery = z.object({ ...pagination });

const createShareBody = z.strictObject({
  productId: z
    .string()
    .trim()
    .min(1, { message: "Product id is required" })
    .max(64, { message: "Invalid product id" }),
});

module.exports = {
  createProfileBody,
  updateProfileBody,
  listProductsQuery,
  listSharesQuery,
  createShareBody,
};