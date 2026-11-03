// Single source of truth for payment status transitions.
// Reuse this from /payments/razorpay/verify too, so verify + webhook can never disagree
// regardless of which one arrives first.

const STATUS = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
};

// target -> statuses it may be reached from.
// Razorpay allows several payment attempts on one order, so FAILED -> CAPTURED is legal.
// CAPTURED is never downgraded by a late/out-of-order authorized or failed event.
const ALLOWED_FROM = {
  [STATUS.PENDING]: [STATUS.CREATED],
  [STATUS.AUTHORIZED]: [STATUS.CREATED, STATUS.PENDING, STATUS.FAILED],
  [STATUS.CAPTURED]: [STATUS.CREATED, STATUS.PENDING, STATUS.AUTHORIZED, STATUS.FAILED, STATUS.REFUND_PENDING],
  [STATUS.FAILED]: [STATUS.CREATED, STATUS.PENDING],
  [STATUS.REFUND_PENDING]: [STATUS.CAPTURED],
  [STATUS.REFUNDED]: [STATUS.CAPTURED, STATUS.REFUND_PENDING],
};

function canTransition(from, to) {
  if (from === to) return false; // no-op, treated as already applied
  return (ALLOWED_FROM[to] || []).includes(from);
}

// Razorpay amount (integer paise) -> decimal string safe for a Prisma Decimal column.
function paiseToDecimalString(paise) {
  const n = Math.trunc(paise);
  return `${Math.trunc(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

// Stored Decimal amount (rupees) must equal the gateway amount (paise) exactly.
function amountMatches(storedDecimal, gatewayPaise) {
  return storedDecimal.mul(100).toFixed(0) === String(gatewayPaise);
}

module.exports = { STATUS, canTransition, paiseToDecimalString, amountMatches };