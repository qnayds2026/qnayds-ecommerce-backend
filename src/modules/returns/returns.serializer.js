// Hides the customer's payout details from people who do not need them.
// ADMIN sees everything, SELLER sees none of it, CUSTOMER sees a masked account number.

const PAYOUT_FIELDS = [
  "refundMethod",
  "refundUpiId",
  "refundAccountName",
  "refundAccountNumber",
  "refundIfsc",
  "manualRefundReference",
];

function maskAccountNumber(value) {
  if (!value) return value;
  const text = String(value);
  return "X".repeat(Math.max(text.length - 4, 0)) + text.slice(-4);
}

function presentOne(ret, role) {
  if (!ret || typeof ret !== "object" || role === "ADMIN") return ret;

  const copy = { ...ret };

  if (role === "CUSTOMER") {
    if (copy.refundAccountNumber) {
      copy.refundAccountNumber = maskAccountNumber(copy.refundAccountNumber);
    }
    return copy;
  }

  // SELLER (or any other role): no payout details at all.
  PAYOUT_FIELDS.forEach((field) => delete copy[field]);
  return copy;
}

// Works for one return and for a list ({ items, total, page, limit }).
function presentReturn(data, role) {
  if (data && Array.isArray(data.items) && "total" in data) {
    return { ...data, items: data.items.map((ret) => presentOne(ret, role)) };
  }
  return presentOne(data, role);
}

module.exports = { presentReturn, maskAccountNumber };