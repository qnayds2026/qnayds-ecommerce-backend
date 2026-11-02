
const { idParam } = require("../../src/modules/order-tracking/tracking-validation");

describe("Order Tracking Validation", () => {
  test("accepts a valid order ID", () => {
    expect(
      idParam.safeParse({ orderId: "order123" }).success
    ).toBe(true);
  });

  test("rejects an empty order ID", () => {
    expect(
      idParam.safeParse({ orderId: "" }).success
    ).toBe(false);
  });

  test("rejects a missing order ID", () => {
    expect(
      idParam.safeParse({}).success
    ).toBe(false);
  });
});
