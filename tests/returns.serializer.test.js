const { presentReturn, maskAccountNumber } = require("../src/modules/returns/returns.serializer");

const makeReturn = (overrides = {}) => ({
  id: "ret_1",
  returnNumber: "RET-1",
  status: "REFUNDED",
  refundAmount: "500.00",
  refundMethod: "BANK",
  refundUpiId: null,
  refundAccountName: "Henna",
  refundAccountNumber: "123456789012",
  refundIfsc: "HDFC0001234",
  manualRefundReference: "412345678901",
  ...overrides,
});

describe("returns.serializer", () => {
  test("admin sees every payout detail", () => {
    const result = presentReturn(makeReturn(), "ADMIN");

    expect(result.refundAccountNumber).toBe("123456789012");
    expect(result.refundIfsc).toBe("HDFC0001234");
    expect(result.manualRefundReference).toBe("412345678901");
  });

  test("customer sees a masked account number, everything else stays", () => {
    const result = presentReturn(makeReturn(), "CUSTOMER");

    expect(result.refundAccountNumber).toBe("XXXXXXXX9012");
    expect(result.refundAccountName).toBe("Henna");
    expect(result.manualRefundReference).toBe("412345678901");
    expect(result.status).toBe("REFUNDED");
  });

  test("seller sees no payout details at all", () => {
    const result = presentReturn(makeReturn(), "SELLER");

    expect(result).not.toHaveProperty("refundMethod");
    expect(result).not.toHaveProperty("refundUpiId");
    expect(result).not.toHaveProperty("refundAccountName");
    expect(result).not.toHaveProperty("refundAccountNumber");
    expect(result).not.toHaveProperty("refundIfsc");
    expect(result).not.toHaveProperty("manualRefundReference");
    expect(result.id).toBe("ret_1");
    expect(result.refundAmount).toBe("500.00");
  });

  test("a list is handled item by item and keeps the paging fields", () => {
    const list = { items: [makeReturn(), makeReturn({ id: "ret_2" })], total: 2, page: 1, limit: 10 };

    const result = presentReturn(list, "CUSTOMER");

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.items.map((i) => i.refundAccountNumber)).toEqual(["XXXXXXXX9012", "XXXXXXXX9012"]);
  });

  test("the original object is never changed", () => {
    const original = makeReturn();

    presentReturn(original, "SELLER");
    presentReturn(original, "CUSTOMER");

    expect(original.refundAccountNumber).toBe("123456789012");
    expect(original.refundIfsc).toBe("HDFC0001234");
  });

  test("a return without bank details (UPI or ONLINE) works for every role", () => {
    const upi = makeReturn({ refundMethod: "UPI", refundUpiId: "henna@okaxis", refundAccountNumber: null });

    expect(presentReturn(upi, "CUSTOMER").refundAccountNumber).toBeNull();
    expect(presentReturn(upi, "ADMIN").refundUpiId).toBe("henna@okaxis");
    expect(presentReturn(null, "CUSTOMER")).toBeNull();
  });

  test("short account numbers are still masked", () => {
    expect(maskAccountNumber("123456789")).toBe("XXXXX6789");
    expect(maskAccountNumber("1234")).toBe("1234");
    expect(maskAccountNumber(null)).toBeNull();
  });
});