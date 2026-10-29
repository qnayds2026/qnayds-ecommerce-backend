const { z } = require("zod");

const idParam = z.object({ id: z.string().min(1) });
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const createCategoryBody = z.object({
  name: z.string().trim().min(2).max(100),
  slug,
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().url().max(2000).optional(),
  parentId: z.string().min(1).nullable().optional(),
});

const updateCategoryBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug,
    description: z.string().trim().max(1000).nullable(),
    imageUrl: z.string().url().max(2000).nullable(),
    parentId: z.string().min(1).nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

module.exports = { idParam, createCategoryBody, updateCategoryBody };