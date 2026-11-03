const ordersService = require("../../services/orders.service");
const paymentsService = require("../payments/payments.service");
const razorpay = require("../payments/razorpay.service");

/**
 * Checkout = create the order from the cart (Teammate 2's createOrder: cart/address validation,
 * server-side prices, stock reservation, Idempotency-Key) + start a payment attempt.
 * paymentMethod ONLINE (default): Razorpay payment attempt, as before.
 * paymentMethod COD: no gateway call, one PENDING payment row with method COD.
 * Calling it again with the same Idempotency-Key returns the same order and reuses the open attempt.
 */
async function checkout(user, body, idempotencyKey) {
  const paymentMethod = body.paymentMethod || "ONLINE";

  // Fail before any stock is reserved if Razorpay is not configured (ONLINE only).
  if (paymentMethod === "ONLINE") {
    razorpay.assertConfigured();
  }

  const order = await ordersService.createOrder(
    user,
    { addressId: body.addressId },
    idempotencyKey
  );

  const summary = {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.totalAmount,
    currency: order.currency,
  };

  // Duplicate request for an order that is already paid/cancelled: nothing to pay.
  if (order.status !== "PENDING_PAYMENT") {
    return { order: summary, payment: null };
  }

  if (paymentMethod === "COD") {
    const payment = await paymentsService.startCodPaymentForOrder(order);
    return { order: summary, payment: paymentsService.toCodDetails(payment) };
  }

  const payment = await paymentsService.startPaymentForOrder(order);
  return { order: summary, payment: paymentsService.toClientDetails(payment) };
}

module.exports = { checkout };