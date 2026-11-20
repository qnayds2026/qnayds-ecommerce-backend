const { z } = require("zod");

const refundDetailsSchema = z.discriminatedUnion("refundMethod", [
  z.object({
    refundMethod: z.literal("UPI"),
    refundUpiId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, "Valid UPI ID venam"),
  }),
  z.object({
    refundMethod: z.literal("BANK"),
    refundAccountName: z.string().trim().min(2).max(100),
    refundAccountNumber: z.string().trim().regex(/^\d{9,18}$/, "Account number 9-18 digits aayirikkanam"),
    refundIfsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Valid IFSC venam"),
  }),
]);

const RETURN_REASONS = [
  "DEFECTIVE",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "SIZE_ISSUE",
  "CHANGED_MIND",
  "OTHER",
];

const idString = (name) =>
  z.string({ required_error: `${name} is required` }).trim().min(1, `${name} is required`);

const optionalNote = z.string().trim().max(500, "Note must be 500 characters or less").optional();

// Customer creates a return. Prices and refund amount are calculated on the server,
// so any extra field is rejected.
const createReturnBody = z
  .object({
    orderId: idString("orderId"),
    reason: z.enum(RETURN_REASONS, {
      errorMap: () => ({ message: "Invalid return reason" }),
    }),
    customerNote: optionalNote,
    refundMethod: z.enum(["UPI", "BANK"]).optional(),
    refundUpiId: z.string().optional(),
    refundAccountName: z.string().optional(),
    refundAccountNumber: z.string().optional(),
    refundIfsc: z.string().optional(),
    items: z
      .array(
        z
          .object({
            orderItemId: idString("orderItemId"),
            quantity: z
              .number({ required_error: "quantity is required" })
              .int("quantity must be a whole number")
              .positive("quantity must be at least 1"),
          })
          .strict()
      )
      .min(1, "Select at least one item to return"),
  })
  .strict()
    .refine(
    (data) => new Set(data.items.map((i) => i.orderItemId)).size === data.items.length,
    { message: "Same item cannot be added twice", path: ["items"] }
  )
    .refine((data) => data.reason !== "OTHER" || Boolean(data.customerNote), {
    message: "Please describe the reason in the note",
    path: ["customerNote"],
  })
  .transform((data, ctx) => {
    if (!data.refundMethod) return data;

    const parsed = refundDetailsSchema.safeParse(data);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) =>
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: issue.path,
        })
      );
      return z.NEVER;
    }
    return { ...data, ...parsed.data };
  });
const returnIdParams = z.object({
  returnId: idString("returnId"),
});

// Seller/admin approve: note is optional.
const approveReturnBody = z.object({ note: optionalNote }).strict();

// Seller/admin reject: a reason (note) is required for the audit trail.
const rejectReturnBody = z
  .object({
    note: z
      .string({ required_error: "A rejection note is required" })
      .trim()
      .min(3, "A rejection note is required")
      .max(500, "Note must be 500 characters or less"),
  })
  .strict();

// Customer cancel: note is optional.
const cancelReturnBody = z.object({ note: optionalNote }).strict();

// Customer requests admin review after seller rejects a return.
const escalateReturnBody = z
  .object({
    reason: z
      .string({ required_error: "Escalation reason is required" })
      .trim()
      .min(3, "Please provide a valid escalation reason")
      .max(500, "Escalation reason must be 500 characters or less"),
  })
  .strict();

// Admin refund: note is optional.
const refundReturnBody = z.object({ note: optionalNote }).strict();

// Admin confirms a manual COD refund by entering the UTR / bank reference number.
const confirmCodRefundBody = z
  .object({
    utr: z
      .string({ required_error: "UTR number is required" })
      .trim()
      .regex(/^[A-Za-z0-9]{6,30}$/, "UTR must be 6-30 letters or digits")
      .transform((value) => value.toUpperCase()),
    note: optionalNote,
  })
  .strict();

  // Admin marks a manual COD refund as failed: the reason is required for the audit trail.
const failCodRefundBody = z
  .object({
    note: z
      .string({ required_error: "A failure note is required" })
      .trim()
      .min(3, "A failure note is required")
      .max(500, "Note must be 500 characters or less"),
  })
  .strict();

// List filters (my / seller / admin lists).
const listReturnsQuery = z.object({
  status: z
    .enum([
      "REQUESTED",
      "APPROVED",
      "REJECTED",
      "CANCELLED",
      "ITEM_RECEIVED",
      "REFUND_INITIATED",
      "REFUND_FAILED",
      "REFUNDED",
      "CLOSED",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  escalatedOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
// Customer adds the courier details of the parcel being sent back.
const shipmentBody = z
  .object({
    carrierName: z
      .string({ required_error: "carrierName is required" })
      .trim()
      .min(2, "carrierName is required")
      .max(100),
    trackingNumber: z
      .string({ required_error: "trackingNumber is required" })
      .trim()
      .min(3, "trackingNumber is required")
      .max(100),
    trackingUrl: z.string().trim().url("trackingUrl must be a valid URL").max(500).optional(),
  })
  .strict();

// Seller/admin confirm the returned item has arrived: note is optional.
const receivedReturnBody = z.object({ note: optionalNote }).strict();
module.exports = {
  RETURN_REASONS,
  createReturnBody,
  returnIdParams,
  approveReturnBody,
  rejectReturnBody,
  cancelReturnBody,
  refundReturnBody,
  shipmentBody,
  receivedReturnBody,
  listReturnsQuery,
  escalateReturnBody,
  confirmCodRefundBody,
  failCodRefundBody,
  refundDetailsSchema
};