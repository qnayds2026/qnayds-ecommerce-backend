const { z } = require("zod");

const productIdParam = z.object({ productId: z.string().min(1) });
const idParam = z.object({ id: z.string().min(1) });

const createImageBody = z.object({
  url: z
    .string()
    .url()
    .max(2000)
    .refine((u) => u.startsWith("https://"), "HTTPS URL required"),
  altText: z.string().trim().max(200).optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const updateImageBody = z
  .object({
    altText: z.string().trim().max(200),
    sortOrder: z.number().int().min(0),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

module.exports = { productIdParam, idParam, createImageBody, updateImageBody };