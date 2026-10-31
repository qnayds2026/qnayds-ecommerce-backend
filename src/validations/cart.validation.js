const { z } = require('zod');

const id = z.string().regex(/^c[a-z0-9]{20,30}$/, 'Invalid id');
const quantity = z.number().int('Quantity must be an integer').positive('Quantity must be greater than zero').max(100);

const addItemSchema = z.object({ variantId: id, quantity }).strict();
const updateItemSchema = z.object({ quantity }).strict();
const itemParamsSchema = z.object({ itemId: id }).strict();

module.exports = { addItemSchema, updateItemSchema, itemParamsSchema };