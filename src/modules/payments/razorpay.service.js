const crypto = require("crypto");
const { Prisma } = require("@prisma/client");

let client = null;

function assertConfigured() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay keys are not configured");
  }
}

// Created lazily so the server can start (and webhooks can be tested) before keys are available.
function getClient() {
  assertConfigured();
  if (!client) {
    const Razorpay = require("razorpay");
    client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
}

// Only the public Key ID is ever sent to the frontend.
function getKeyId() {
  return process.env.RAZORPAY_KEY_ID;
}

// Decimal rupees -> integer paise, without floating point maths.
function toPaise(amount) {
  return Number(new Prisma.Decimal(amount.toString()).mul(100).toFixed(0));
}

function createGatewayOrder({ amountPaise, currency, receipt, notes }) {
  return getClient().orders.create({
    amount: amountPaise,
    currency,
    receipt,
    notes,
  });
}

function fetchGatewayPayment(gatewayPaymentId) {
  return getClient().payments.fetch(gatewayPaymentId);
}

// Refund against a captured payment. Amount is in paise.
// receipt/notes only help us trace the refund back to the return in the Razorpay dashboard.
function createGatewayRefund({ gatewayPaymentId, amountPaise, receipt, notes }) {
  return getClient().payments.refund(gatewayPaymentId, {
    amount: amountPaise,
    speed: "normal",
    receipt,
    notes,
  });
}

// Looks at the refunds Razorpay already has for this payment and returns the one made for this
// return (notes.returnId), unless it failed. Used before creating a refund, so a retry after a
// timeout reuses the existing refund instead of creating a second one.
async function findGatewayRefundForReturn(gatewayPaymentId, returnId) {
  const result = await getClient().payments.fetchMultipleRefund(gatewayPaymentId, { count: 100 });
  const items = (result && result.items) || [];
  return (
    items.find((r) => r.notes && r.notes.returnId === returnId && r.status !== "failed") || null
  );
}

// Checkout signature: HMAC-SHA256(`${order_id}|${payment_id}`, KEY_SECRET), hex.
function verifyPaymentSignature({ gatewayOrderId, gatewayPaymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !signature || !gatewayOrderId || !gatewayPaymentId) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(String(signature), "utf8");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = {
  assertConfigured,
  getKeyId,
  toPaise,
  createGatewayOrder,
  fetchGatewayPayment,
  createGatewayRefund,
  findGatewayRefundForReturn,
  verifyPaymentSignature,
};