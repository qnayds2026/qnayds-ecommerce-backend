
const {
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  canTransitionOrderStatus,
} = require("../../src/modules/orders/order-status");

describe("Order Status", () => {
  test("should contain all seven order statuses", () => {
    expect(ORDER_STATUS_VALUES).toHaveLength(7);
  });

  test("should allow PENDING_PAYMENT to CONFIRMED", () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.PENDING_PAYMENT,
        ORDER_STATUS.CONFIRMED
      )
    ).toBe(true);
  });

  test("should allow CONFIRMED to PROCESSING", () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.CONFIRMED,
        ORDER_STATUS.PROCESSING
      )
    ).toBe(true);
  });

  test("should allow PROCESSING to SHIPPED", () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.PROCESSING,
        ORDER_STATUS.SHIPPED
      )
    ).toBe(true);
  });

  test("should allow SHIPPED to DELIVERED", () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.SHIPPED,
        ORDER_STATUS.DELIVERED
      )
    ).toBe(true);
  });

  test("should reject invalid status transitions", () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.PENDING_PAYMENT,
        ORDER_STATUS.SHIPPED
      )
    ).toBe(false);
  });

  test("should not allow transitions from CANCELLED", () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.CANCELLED,
        ORDER_STATUS.CONFIRMED
      )
    ).toBe(false);
  });

  test("should not allow transitions from REFUNDED", () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.REFUNDED,
        ORDER_STATUS.CONFIRMED
      )
    ).toBe(false);
  });
});
