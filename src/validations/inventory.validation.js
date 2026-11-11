const { z } = require("zod");

const idParam = z.object({ id: z.string().min(1) });

// Rendilonnu maathram: delta (+/-) allenkil absolute available
const updateInventoryBody = z
  .object({
    delta: z.number().int().min(-1000000).max(1000000),
    available: z.number().int().min(0).max(1000000),
  })
  .partial()
  .refine(
    (o) => (o.delta !== undefined) !== (o.available !== undefined),
    "Provide exactly one of delta or available"
  );

  // Query for GET /inventory/admin/all (ADMIN only).
// Example: /inventory/admin/all?page=1&limit=10&search=TEST&lowStock=true
const adminListInventoryQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  lowStock: z.enum(["true", "false"]).optional(),
});

module.exports = { idParam, updateInventoryBody, adminListInventoryQuery };

