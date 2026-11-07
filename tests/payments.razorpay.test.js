const crypto = require("crypto");

process.env.RAZORPAY_KEY_SECRET = "test_key_secret";

const {
  verifyPaymentSignature,
  toPaise,
} = require("../src/modules/payments/razorpay.service");

const sign = (orderId, paymentId, secret = "test_key_secret") =>
  crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

describe("verifyPaymentSignature", () => {
  test("accepts a valid signature", () => {
    expect(
      verifyPaymentSignature({
        gatewayOrderId: "order_1",
        gatewayPaymentId: "pay_1",
        signature: sign("order_1", "pay_1"),
      })
    ).toBe(true);
  });

  test("rejects a wrong secret", () => {
    expect(
      verifyPaymentSignature({
        gatewayOrderId: "order_1",
        gatewayPaymentId: "pay_1",
        signature: sign("order_1", "pay_1", "other"),
      })
    ).toBe(false);
  });

  test("rejects a signature made for a different payment id", () => {
    expect(
      verifyPaymentSignature({
        gatewayOrderId: "order_1",
        gatewayPaymentId: "pay_2",
        signature: sign("order_1", "pay_1"),
      })
    ).toBe(false);
  });

  test("rejects missing signature", () => {
    expect(
      verifyPaymentSignature({
        gatewayOrderId: "order_1",
        gatewayPaymentId: "pay_1",
        signature: undefined,
      })
    ).toBe(false);
  });
});

describe("toPaise", () => {
  test("converts decimal rupees to integer paise exactly", () => {
    expect(toPaise("499.00")).toBe(49900);
    expect(toPaise("0.10")).toBe(10);
    expect(toPaise("19.99")).toBe(1999);
    expect(toPaise("1234.56")).toBe(123456);
  });
});