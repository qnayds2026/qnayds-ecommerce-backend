
const SHIPPING_STATUS = {
  READY_TO_SHIP: "READY_TO_SHIP",
  PACKED: "PACKED",
  SHIPPED: "SHIPPED",
  IN_TRANSIT: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  DELIVERY_FAILED: "DELIVERY_FAILED",
  RETURN_TO_ORIGIN: "RETURN_TO_ORIGIN",
};

const SHIPPING_STATUS_VALUES = Object.values(
  SHIPPING_STATUS
);

const SHIPPING_STATUS_TRANSITIONS = {
  READY_TO_SHIP: ["PACKED"],
  PACKED: ["SHIPPED"],
  SHIPPED: [
    "IN_TRANSIT",
    "DELIVERY_FAILED",
  ],
  IN_TRANSIT: [
    "OUT_FOR_DELIVERY",
    "DELIVERY_FAILED",
    "RETURN_TO_ORIGIN",
  ],
  OUT_FOR_DELIVERY: [
    "DELIVERED",
    "DELIVERY_FAILED",
    "RETURN_TO_ORIGIN",
  ],
  DELIVERY_FAILED: [
    "IN_TRANSIT",
    "RETURN_TO_ORIGIN",
  ],
  DELIVERED: [],
  RETURN_TO_ORIGIN: [],
};

function canTransitionShippingStatus(
  currentStatus,
  nextStatus
) {
  const allowed =
    SHIPPING_STATUS_TRANSITIONS[currentStatus];

  return allowed
    ? allowed.includes(nextStatus)
    : false;
}

module.exports = {
  SHIPPING_STATUS,
  SHIPPING_STATUS_VALUES,
  SHIPPING_STATUS_TRANSITIONS,
  canTransitionShippingStatus,
};
