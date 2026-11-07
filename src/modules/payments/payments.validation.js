const { z } = require("zod");

const idField = z.string().trim().min(1).max(100);

const createRazorpayOrderBody = z.object({
  orderId: idField,
});

const verifyPaymentBody = z.object({
  razorpay_order_id: idField,
  razorpay_payment_id: idField,
  razorpay_signature: z.string().trim().min(1).max(200),
});

const paymentIdParam = z.object({
  paymentId: idField,
});

module.exports = {
  createRazorpayOrderBody,
  verifyPaymentBody,
  paymentIdParam,
};