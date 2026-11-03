
const {
  idParam,
  updateOrderStatusBody,
  createShipmentBody,
  cancelOrderBody,
} = require("../../src/modules/orders/order-validation");

describe("Order Validation", () => {
  test("accepts a valid order ID", () => {
    expect(idParam.safeParse({ orderId: "order123" }).success).toBe(true);
  });

  test("rejects an empty order ID", () => {
    expect(idParam.safeParse({ orderId: "" }).success).toBe(false);
  });

  test("accepts a valid order status", () => {
    expect(
      updateOrderStatusBody.safeParse({ status: "PROCESSING" }).success
    ).toBe(true);
  });

  test("rejects an invalid order status", () => {
    expect(
      updateOrderStatusBody.safeParse({ status: "WRONG_STATUS" }).success
    ).toBe(false);
  });

  test("accepts valid shipment details", () => {
    expect(
      createShipmentBody.safeParse({
        carrierName: "BlueDart",
        trackingNumber: "BD12345",
        trackingUrl: "https://example.com/track/BD12345",
      }).success
    ).toBe(true);
  });

  test("rejects an invalid tracking URL", () => {
    expect(
      createShipmentBody.safeParse({
        carrierName: "BlueDart",
        trackingNumber: "BD12345",
        trackingUrl: "invalid-url",
      }).success
    ).toBe(false);
  });

  test("accepts a valid cancellation reason", () => {
    expect(
      cancelOrderBody.safeParse({
        reason: "Customer requested cancellation",
      }).success
    ).toBe(true);
  });

  test("rejects a short cancellation reason", () => {
    expect(
      cancelOrderBody.safeParse({ reason: "No" }).success
    ).toBe(false);
  });
});
