const {
  idParam,
  createSellerBody,
  updateStatusBody,
  listSellerQuery,
  listSellersQuery,
} = require("../src/validations/seller.validation");

const validBody = (overrides = {}) => ({
  shopName: "Test Shop One",
  description: "Test seller",
  gstNumber: "22AAAAA0000A1Z5",
  idProofType: "PAN",
  idProofNumber: "ABCDE1234F",
  addressLine1: "12 Test Street",
  city: "Tirur",
  state: "Kerala",
  postalCode: "676101",
  ...overrides,
});

// Removes a key from the valid body (to test "missing field").
const without = (field) => {
  const body = validBody();
  delete body[field];
  return body;
};

const messagesFor = (result, field) =>
  result.error.issues.filter((i) => i.path[0] === field).map((i) => i.message);

const expectFieldError = (result, field, message) => {
  expect(result.success).toBe(false);
  const messages = messagesFor(result, field);
  if (message) {
    expect(messages).toContain(message);
  } else {
    expect(messages.length).toBeGreaterThan(0);
  }
};

describe("createSellerBody", () => {
  describe("happy path", () => {
    it("accepts a fully valid body", () => {
      const result = createSellerBody.safeParse(validBody());
      expect(result.success).toBe(true);
    });

    it("accepts a body without GST (GST is optional)", () => {
      const result = createSellerBody.safeParse(without("gstNumber"));
      expect(result.success).toBe(true);
      expect(result.data.gstNumber).toBeUndefined();
    });

    it("defaults country to India", () => {
      const result = createSellerBody.safeParse(validBody());
      expect(result.data.country).toBe("India");
    });

    it("keeps a custom country", () => {
      const result = createSellerBody.safeParse(validBody({ country: "Nepal" }));
      expect(result.data.country).toBe("Nepal");
    });

    it("accepts optional addressLine2 and description being absent", () => {
      const body = validBody();
      delete body.description;
      const result = createSellerBody.safeParse({ ...body, addressLine2: "Near Bus Stand" });
      expect(result.success).toBe(true);
    });
  });

  describe("shopName", () => {
    it("fails when missing", () => {
      expectFieldError(createSellerBody.safeParse(without("shopName")), "shopName");
    });

    it("fails when shorter than 2 characters", () => {
      expectFieldError(createSellerBody.safeParse(validBody({ shopName: "A" })), "shopName");
    });

    it("fails when longer than 100 characters", () => {
      expectFieldError(
        createSellerBody.safeParse(validBody({ shopName: "A".repeat(101) })),
        "shopName"
      );
    });

    it("trims whitespace", () => {
      const result = createSellerBody.safeParse(validBody({ shopName: "  My Shop  " }));
      expect(result.data.shopName).toBe("My Shop");
    });
  });

  describe("description", () => {
    it("fails when longer than 1000 characters", () => {
      expectFieldError(
        createSellerBody.safeParse(validBody({ description: "x".repeat(1001) })),
        "description"
      );
    });
  });

  describe("gstNumber", () => {
    it("accepts a valid GST number", () => {
      const result = createSellerBody.safeParse(validBody({ gstNumber: "22AAAAA0000A1Z5" }));
      expect(result.success).toBe(true);
    });

    it("uppercases a lowercase GST number", () => {
      const result = createSellerBody.safeParse(validBody({ gstNumber: "22aaaaa0000a1z5" }));
      expect(result.success).toBe(true);
      expect(result.data.gstNumber).toBe("22AAAAA0000A1Z5");
    });

    it.each([["123"], ["22AAAAA0000A1Y5"], ["AAAAAAA0000A1Z5"], ["22AAAAA0000A1Z"]])(
      "rejects invalid GST %p",
      (gst) => {
        expectFieldError(
          createSellerBody.safeParse(validBody({ gstNumber: gst })),
          "gstNumber",
          "Invalid GST number"
        );
      }
    );

    it.each([[""], ["   "]])("treats empty/blank GST %p as not provided", (gst) => {
      const result = createSellerBody.safeParse(validBody({ gstNumber: gst }));
      expect(result.success).toBe(true);
      // The schema keeps "" as-is, so the service must convert "" to null.
      expect(result.data.gstNumber).toBe("");
    });
  });

  describe("idProofType", () => {
    it.each([["PAN"], ["AADHAAR"], ["VOTER_ID"], ["DRIVING_LICENCE"], ["PASSPORT"]])(
      "accepts %s as a type",
      (type) => {
        const numbers = {
          PAN: "ABCDE1234F",
          AADHAAR: "123456789012",
          VOTER_ID: "ABC1234567",
          DRIVING_LICENCE: "KL0720110012345",
          PASSPORT: "A1234567",
        };
        const result = createSellerBody.safeParse(
          validBody({ idProofType: type, idProofNumber: numbers[type] })
        );
        expect(result.success).toBe(true);
      }
    );

    it("fails when missing", () => {
      expectFieldError(createSellerBody.safeParse(without("idProofType")), "idProofType");
    });

    it("fails for an unknown type", () => {
      expectFieldError(
        createSellerBody.safeParse(validBody({ idProofType: "RATION_CARD" })),
        "idProofType"
      );
    });

    it("is case sensitive (lowercase type is rejected)", () => {
      expectFieldError(createSellerBody.safeParse(validBody({ idProofType: "pan" })), "idProofType");
    });
  });

  describe("idProofNumber per type", () => {
    it.each([
      ["PAN", "ABCDE1234F"],
      ["AADHAAR", "123456789012"],
      ["VOTER_ID", "ABC1234567"],
      ["DRIVING_LICENCE", "KL0720110012345"],
      ["DRIVING_LICENCE", "KL07201100123"], // shortest allowed (13 chars)
      ["PASSPORT", "A1234567"],
    ])("accepts valid %s number %p", (type, number) => {
      const result = createSellerBody.safeParse(
        validBody({ idProofType: type, idProofNumber: number })
      );
      expect(result.success).toBe(true);
    });

    it.each([
      ["PAN", "12345", "Invalid PAN number"],
      ["PAN", "ABCDE12345", "Invalid PAN number"],
      ["PAN", "ABCD1234FF", "Invalid PAN number"],
      ["AADHAAR", "123", "Aadhaar number must be 12 digits"],
      ["AADHAAR", "12345678901", "Aadhaar number must be 12 digits"], // 11 digits
      ["AADHAAR", "1234567890123", "Aadhaar number must be 12 digits"], // 13 digits
      ["AADHAAR", "ABCDEFGHIJKL", "Aadhaar number must be 12 digits"],
      ["VOTER_ID", "AB12345678", "Invalid Voter ID number"],
      ["VOTER_ID", "ABC123456", "Invalid Voter ID number"],
      ["DRIVING_LICENCE", "K0720110012345", "Invalid driving licence number"],
      ["DRIVING_LICENCE", "KL0720110012", "Invalid driving licence number"], // too short
      ["DRIVING_LICENCE", "KL0720110012345678", "Invalid driving licence number"], // too long
      ["PASSPORT", "12345678", "Invalid passport number"],
      ["PASSPORT", "AB123456", "Invalid passport number"],
    ])("rejects %s number %p", (type, number, message) => {
      expectFieldError(
        createSellerBody.safeParse(validBody({ idProofType: type, idProofNumber: number })),
        "idProofNumber",
        message
      );
    });

    it("rejects a PAN-format number when type is AADHAAR (type/number mismatch)", () => {
      expectFieldError(
        createSellerBody.safeParse(
          validBody({ idProofType: "AADHAAR", idProofNumber: "ABCDE1234F" })
        ),
        "idProofNumber",
        "Aadhaar number must be 12 digits"
      );
    });

    it("rejects an Aadhaar-format number when type is PAN (type/number mismatch)", () => {
      expectFieldError(
        createSellerBody.safeParse(validBody({ idProofType: "PAN", idProofNumber: "123456789012" })),
        "idProofNumber",
        "Invalid PAN number"
      );
    });

    it("uppercases and trims the number", () => {
      const result = createSellerBody.safeParse(validBody({ idProofNumber: "  abcde1234f " }));
      expect(result.success).toBe(true);
      expect(result.data.idProofNumber).toBe("ABCDE1234F");
    });

    it.each([["1234 5678 9012"], ["1234-5678-9012"]])(
      "strips spaces/hyphens from Aadhaar %p",
      (number) => {
        const result = createSellerBody.safeParse(
          validBody({ idProofType: "AADHAAR", idProofNumber: number })
        );
        expect(result.success).toBe(true);
        expect(result.data.idProofNumber).toBe("123456789012");
      }
    );

    it('uses message "ID proof number is required" when missing', () => {
      expectFieldError(
        createSellerBody.safeParse(without("idProofNumber")),
        "idProofNumber",
        "ID proof number is required"
      );
    });
  });

  describe("address fields", () => {
    // Regression lock: Zod v4 ignores `required_error`, which gave the generic
    // "Invalid input: expected string, received undefined" message. Use `message`.
    it('returns exactly "City is required" when city is missing', () => {
      const result = createSellerBody.safeParse(without("city"));
      expectFieldError(result, "city", "City is required");
      expect(messagesFor(result, "city").join(" ")).not.toMatch(/Invalid input/);
    });

    it('returns "State is required" when state is missing', () => {
      expectFieldError(createSellerBody.safeParse(without("state")), "state", "State is required");
    });

    it('returns "Address is required" when addressLine1 is missing', () => {
      expectFieldError(
        createSellerBody.safeParse(without("addressLine1")),
        "addressLine1",
        "Address is required"
      );
    });

    it('returns "PIN code is required" when postalCode is missing', () => {
      expectFieldError(
        createSellerBody.safeParse(without("postalCode")),
        "postalCode",
        "PIN code is required"
      );
    });

    it('rejects too-short addressLine1, city and state with "... is required"', () => {
      expectFieldError(
        createSellerBody.safeParse(validBody({ addressLine1: "ab" })),
        "addressLine1",
        "Address is required"
      );
      expectFieldError(
        createSellerBody.safeParse(validBody({ city: "A" })),
        "city",
        "City is required"
      );
      expectFieldError(
        createSellerBody.safeParse(validBody({ state: "K" })),
        "state",
        "State is required"
      );
    });

    it("rejects blank (whitespace only) city", () => {
      expectFieldError(createSellerBody.safeParse(validBody({ city: "   " })), "city", "City is required");
    });

    it("rejects over-long addressLine1 / addressLine2", () => {
      expectFieldError(
        createSellerBody.safeParse(validBody({ addressLine1: "a".repeat(201) })),
        "addressLine1"
      );
      expectFieldError(
        createSellerBody.safeParse(validBody({ addressLine2: "a".repeat(201) })),
        "addressLine2"
      );
    });
  });

  describe("postalCode", () => {
    it("accepts a valid 6-digit PIN", () => {
      expect(createSellerBody.safeParse(validBody({ postalCode: "676101" })).success).toBe(true);
    });

    it.each([["012345"], ["67610"], ["6761011"], ["67610A"], ["676 101"]])(
      "rejects PIN %p",
      (pin) => {
        expectFieldError(
          createSellerBody.safeParse(validBody({ postalCode: pin })),
          "postalCode",
          "Invalid PIN code"
        );
      }
    );
  });
});

describe("updateStatusBody", () => {
  it.each([["APPROVED"], ["SUSPENDED"]])("accepts %s without a reason", (status) => {
    expect(updateStatusBody.safeParse({ status }).success).toBe(true);
  });

  it("requires a reason when REJECTED", () => {
    const result = updateStatusBody.safeParse({ status: "REJECTED" });
    expectFieldError(result, "reason", "Reason is required when rejecting a seller");
  });

  it("treats a whitespace-only reason as missing when REJECTED", () => {
    const result = updateStatusBody.safeParse({ status: "REJECTED", reason: "   " });
    expectFieldError(result, "reason", "Reason is required when rejecting a seller");
  });

  it("accepts REJECTED with a reason", () => {
    expect(
      updateStatusBody.safeParse({ status: "REJECTED", reason: "Invalid documents" }).success
    ).toBe(true);
  });

  it("rejects PENDING and unknown statuses", () => {
    expectFieldError(updateStatusBody.safeParse({ status: "PENDING" }), "status");
    expectFieldError(updateStatusBody.safeParse({ status: "DELETED" }), "status");
  });

  it("rejects a reason longer than 500 characters", () => {
    expectFieldError(
      updateStatusBody.safeParse({ status: "APPROVED", reason: "x".repeat(501) }),
      "reason"
    );
  });
});

describe("listSellerQuery", () => {
  it("applies defaults", () => {
    const result = listSellerQuery.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ page: 1, limit: 20 });
  });

  it("coerces string numbers from the query string", () => {
    const result = listSellerQuery.safeParse({ page: "2", limit: "10" });
    expect(result.data).toMatchObject({ page: 2, limit: 10 });
  });

  it("rejects page 0 and limit above 50", () => {
    expectFieldError(listSellerQuery.safeParse({ page: "0" }), "page");
    expectFieldError(listSellerQuery.safeParse({ limit: "51" }), "limit");
  });

  it("validates status and trims search", () => {
    expectFieldError(listSellerQuery.safeParse({ status: "UNKNOWN" }), "status");
    const result = listSellerQuery.safeParse({ status: "PENDING", search: "  shop " });
    expect(result.data).toMatchObject({ status: "PENDING", search: "shop" });
  });
});

describe("listSellersQuery", () => {
  it("accepts an empty query and a valid status", () => {
    expect(listSellersQuery.safeParse({}).success).toBe(true);
    expect(listSellersQuery.safeParse({ status: "APPROVED" }).success).toBe(true);
  });

  it("rejects an invalid status", () => {
    expectFieldError(listSellersQuery.safeParse({ status: "NOPE" }), "status");
  });
});

describe("idParam", () => {
  it("accepts a non-empty id", () => {
    expect(idParam.safeParse({ id: "abc123" }).success).toBe(true);
  });

  it("rejects an empty or missing id", () => {
    expectFieldError(idParam.safeParse({ id: "" }), "id");
    expectFieldError(idParam.safeParse({}), "id");
  });
});