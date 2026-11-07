const { z } = require("zod");

// Razorpay amounts are integers in the smallest currency unit (paise for INR).
const paymentEntity = z
  .object({
    id: z.string().min(1),
    order_id: z.string().nullable().optional(),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    status: z.string().optional(),
    error_code: z.string().nullable().optional(),
    error_description: z.string().nullable().optional(),
  })
  .passthrough();

const refundEntity = z
  .object({
    id: z.string().min(1),
    payment_id: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    status: z.string().optional(),
  })
  .passthrough();

const orderEntity = z
  .object({
    id: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
  })
  .passthrough();

// Outer envelope only: per-event payload shape is validated inside the handlers.
const razorpayEnvelopeSchema = z
  .object({
    event: z.string().min(1),
    created_at: z.number().int().optional(),
    payload: z.record(z.string(), z.any()).default({}),
  })
  .passthrough();

const paymentPayloadSchema = z.object({
  payment: z.object({ entity: paymentEntity }),
  order: z.object({ entity: orderEntity }).optional(),
});

const refundPayloadSchema = z.object({
  refund: z.object({ entity: refundEntity }),
  payment: z.object({ entity: paymentEntity }).optional(),
});

module.exports = {
  razorpayEnvelopeSchema,
  paymentPayloadSchema,
  refundPayloadSchema,
};