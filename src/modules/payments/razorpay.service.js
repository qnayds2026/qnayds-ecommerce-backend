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
  verifyPaymentSignature,
};