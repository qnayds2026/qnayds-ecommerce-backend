const crypto = require("crypto");
const { verifyWebhookSignature } = require("../src/modules/webhooks/razorpay.signature");
const { amountMatches, canTransition, STATUS } = require("../src/modules/payments/payment-state");

const SECRET = "test_webhook_secret";
const body = Buffer.from(JSON.stringify({ event: "payment.captured", payload: {} }));
const sign = (buf, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(buf).digest("hex");

describe("verifyWebhookSignature", () => {
  test("accepts a valid signature", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });
  test("rejects a wrong signature", () => {
    expect(verifyWebhookSignature(body, sign(body, "other"), SECRET)).toBe(false);
  });
  test("rejects a tampered body", () => {
    expect(verifyWebhookSignature(Buffer.from('{"event":"x"}'), sign(body), SECRET)).toBe(false);
  });
  test("rejects missing signature or a parsed (non-raw) body", () => {
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature({ event: "x" }, sign(body), SECRET)).toBe(false);
  });
});

describe("payment state rules", () => {
  test("captured payment is never downgraded by a late authorized/failed event", () => {
    expect(canTransition(STATUS.CAPTURED, STATUS.AUTHORIZED)).toBe(false);
    expect(canTransition(STATUS.CAPTURED, STATUS.FAILED)).toBe(false);
  });
  test("failed attempt can still become captured", () => {
    expect(canTransition(STATUS.FAILED, STATUS.CAPTURED)).toBe(true);
  });
  test("duplicate transition is a no-op", () => {
    expect(canTransition(STATUS.CAPTURED, STATUS.CAPTURED)).toBe(false);
  });
  test("amount comparison is exact (paise vs decimal rupees)", () => {
    const dec = (s) => ({
      mul: (n) => ({ toFixed: () => String(Math.round(parseFloat(s) * n)) }),
    });
    expect(amountMatches(dec("499.00"), 49900)).toBe(true);
    expect(amountMatches(dec("499.00"), 49901)).toBe(false);
  });
});