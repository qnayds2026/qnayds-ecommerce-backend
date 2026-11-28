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

const quoteBody = z.strictObject({
  variantId: z
    .string()
    .trim()
    .min(1, { message: "Variant id is required" })
    .max(64, { message: "Invalid variant id" }),
  quantity: z.coerce
    .number()
    .int({ message: "Quantity must be a whole number" })
    .min(1, { message: "Quantity must be at least 1" })
    .max(100, { message: "Quantity must be at most 100" }),
  margin: z.coerce
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, {
      message: "Margin must be a non-negative amount with up to 2 decimals",
    }),
});

const orderItem = z.strictObject({
  variantId: z
    .string()
    .trim()
    .min(1, { message: "Variant id is required" })
    .max(64, { message: "Invalid variant id" }),
  quantity: z.coerce
    .number()
    .int({ message: "Quantity must be a whole number" })
    .min(1, { message: "Quantity must be at least 1" })
    .max(100, { message: "Quantity must be at most 100" }),
  margin: z.coerce
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, {
      message: "Margin must be a non-negative amount with up to 2 decimals",
    }),
});

// Delivery details of the end customer the reseller is ordering for.
const orderCustomer = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, { message: "Customer name must be at least 2 characters" })
    .max(80, { message: "Customer name must be at most 80 characters" }),
  phone,
  addressLine1: z
    .string()
    .trim()
    .min(5, { message: "Address line 1 must be at least 5 characters" })
    .max(200, { message: "Address line 1 must be at most 200 characters" }),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, { message: "City is required" }).max(80),
  state: z.string().trim().min(2, { message: "State is required" }).max(80),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { message: "Enter a valid 6-digit PIN code" }),
});

const createOrderBody = z.strictObject({
  items: z
    .array(orderItem)
    .min(1, { message: "At least one item is required" })
    .max(20, { message: "At most 20 items per order" })
    .refine(
      (items) => new Set(items.map((i) => i.variantId)).size === items.length,
      { message: "Each variant can appear only once" }
    ),
  customer: orderCustomer,
  shareCode: z.string().trim().min(1).max(32).optional(),
  paymentMethod: z.enum(["ONLINE", "COD"]).default("ONLINE"),
});

const listOrdersQuery = z.object({ ...pagination });

const earningsQuery = z.object({
  ...pagination,
  status: z.enum([
    "PENDING",
    "ELIGIBLE",
    "IN_SETTLEMENT",
    "SETTLED",
    "CANCELLED",
  ]).optional(),
});

const settlementsQuery = z.object({
  ...pagination,
  status: z.enum([
    "REQUESTED",
    "APPROVED",
    "REJECTED",
    "PROCESSING",
    "PAID",
    "FAILED",
  ]).optional(),
});

const settlementIdParam = z.strictObject({
  id: z.string().trim().min(1, "Settlement ID is required"),
});

const requestSettlementBody = z.strictObject({
  bankAccountId: z.string().trim().min(1).max(64).optional(),
});

module.exports = {
  createProfileBody,
  updateProfileBody,
  listProductsQuery,
  listSharesQuery,
  createShareBody,
  quoteBody,
  createOrderBody,
  listOrdersQuery,
  earningsQuery,
  settlementsQuery,
  settlementIdParam,
  requestSettlementBody,
};