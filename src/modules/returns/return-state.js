const ApiError = require("../../utils/ApiError");

const STATUS = {
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  ITEM_RECEIVED: "ITEM_RECEIVED",
  REFUND_INITIATED: "REFUND_INITIATED",
  REFUND_FAILED: "REFUND_FAILED",
  REFUNDED: "REFUNDED",
  CLOSED: "CLOSED",
};

// from -> { to: [roles allowed to make that change] }
const TRANSITIONS = {
  REQUESTED: {
    APPROVED: ["SELLER", "ADMIN"],
    REJECTED: ["SELLER", "ADMIN"],
    CANCELLED: ["CUSTOMER"],
  },
  APPROVED: {
    ITEM_RECEIVED: ["SELLER", "ADMIN"],
    CANCELLED: ["CUSTOMER"],
  },
  ITEM_RECEIVED: {
    REFUND_INITIATED: ["ADMIN"],
  },
  REFUND_INITIATED: {
    REFUNDED: ["SYSTEM"],
    REFUND_FAILED: ["SYSTEM"],
  },
  REFUND_FAILED: {
    REFUND_INITIATED: ["ADMIN"],
  },
  REFUNDED: {
    CLOSED: ["SYSTEM"],
  },
};

// Statuses that still hold the items (so those quantities cannot be returned again).
const ACTIVE_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "ITEM_RECEIVED",
  "REFUND_INITIATED",
  "REFUND_FAILED",
  "REFUNDED",
  "CLOSED",
];

function canTransition(from, to, role) {
  const allowed = TRANSITIONS[from] && TRANSITIONS[from][to];
  return Boolean(allowed && allowed.includes(role));
}

function isTerminal(status) {
  return !TRANSITIONS[status];
}

// Throws 409 for an invalid move, 403 when the move exists but this role may not do it.
function assertTransition(from, to, role) {
  const allowed = TRANSITIONS[from] && TRANSITIONS[from][to];
  if (!allowed) {
    throw ApiError.conflict(`Return cannot move from ${from} to ${to}`);
  }
  if (!allowed.includes(role)) {
    throw ApiError.forbidden("You are not allowed to make this change");
  }
}

module.exports = { STATUS, TRANSITIONS, ACTIVE_STATUSES, canTransition, isTerminal, assertTransition };