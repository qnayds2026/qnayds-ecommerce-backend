const { z } = require("zod");

const idParam = z.object({ id: z.string().min(1) });
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const createProductBody = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  slug: slug.optional(), // illenkil name-il ninnu undaakkum
  description: z.string().trim().max(5000).optional(),
  brand: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
});

const updateProductBody = z
  .object({
    categoryId: z.string().min(1),
    name: z.string().trim().min(2).max(200),
    slug,
    description: z.string().trim().max(5000),
    brand: z.string().trim().max(100),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

const listProductsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().min(1).optional(),
  brand: z.string().trim().max(100).optional(),
});

module.exports = {
  idParam,
  createProductBody,
  updateProductBody,
  listProductsQuery,
};