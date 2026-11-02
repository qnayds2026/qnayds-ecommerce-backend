const { z } = require('zod');

const productParamsSchema = z
  .object({ productId: z.string().regex(/^c[a-z0-9]{20,30}$/, 'Invalid product id') })
  .strict();

module.exports = { productParamsSchema };