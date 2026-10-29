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

module.exports = { idParam, updateInventoryBody };