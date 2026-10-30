const { z } = require('zod');

const trimmed = (min, max, label) =>
  z.string({ required_error: `${label} is required` }).trim().min(min, `${label} is required`).max(max);

// India-first: 10-digit mobile (optional +91 / 0 prefix) and 6-digit PIN code.
const phone = z
  .string()
  .trim()
  .regex(/^(?:\+91[\s-]?|0)?[6-9]\d{9}$/, 'Invalid phone number');
const postalCode = z.string().trim().regex(/^[1-9]\d{5}$/, 'Invalid postal code');

const baseFields = {
  recipientName: trimmed(2, 100, 'Recipient name'),
  phone,
  addressLine1: trimmed(3, 200, 'Address line 1'),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: trimmed(2, 100, 'City'),
  state: trimmed(2, 100, 'State'),
  postalCode,
  country: z.string().trim().min(2).max(100).default('India'),
  isDefault: z.boolean().optional(),
};

const createAddressSchema = z.object(baseFields).strict();

const updateAddressSchema = z
  .object(baseFields)
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' });

const addressParamsSchema = z
  .object({ addressId: z.string().regex(/^c[a-z0-9]{20,30}$/, 'Invalid address id') })
  .strict();

module.exports = { createAddressSchema, updateAddressSchema, addressParamsSchema };