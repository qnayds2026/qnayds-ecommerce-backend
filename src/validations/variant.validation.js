const { z } = require("zod");

const money = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Invalid price format")
  .refine((s) => parseFloat(s) > 0, "Price must be greater than 0");

const productIdParam = z.object({ productId: z.string().min(1) });
const idParam = z.object({ id: z.string().min(1) });

const createVariantBody = z
  .object({
    name: z.string().trim().max(100).optional(),
    sku: z.string().trim().min(2).max(64),
    price: money,
    compareAtPrice: money.nullable().optional(),
    attributes: z.record(z.string(), z.any()).default({}),
    initialStock: z.number().int().min(0).default(0),
  })
  .refine(
    (o) => !o.compareAtPrice || parseFloat(o.compareAtPrice) >= parseFloat(o.price),
    { message: "compareAtPrice must be >= price", path: ["compareAtPrice"] }
  );

const updateVariantBody = z
  .object({
    name: z.string().trim().max(100),
    sku: z.string().trim().min(2).max(64),
    price: money,
    compareAtPrice: money.nullable(),
    attributes: z.record(z.string(), z.any()),
    isActive: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

module.exports = { productIdParam, idParam, createVariantBody, updateVariantBody };