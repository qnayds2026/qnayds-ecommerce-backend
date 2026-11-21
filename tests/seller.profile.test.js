jest.mock("../src/config/db", () => ({
  prisma: {
    sellerProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const { prisma } = require("../src/config/db");
const {
  createSellerProfile,
  getMySellerProfile,
} = require("../src/services/seller.service");

const baseData = (overrides = {}) => ({
  shopName: "Test Shop One",
  description: "Test seller",
  gstNumber: "22AAAAA0000A1Z5",
  idProofType: "PAN",
  idProofNumber: "ABCDE1234F",
  addressLine1: "12 Test Street",
  addressLine2: "Near Bus Stand",
  city: "Tirur",
  state: "Kerala",
  postalCode: "676101",
  country: "India",
  ...overrides,
});

describe("Seller Service - createSellerProfile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.sellerProfile.findUnique.mockResolvedValue(null);
    // create() echoes back the data it was given, like the real DB would.
    prisma.sellerProfile.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "seller-1", ...data })
    );
  });

  it("saves the full PAN but returns it masked", async () => {
    const result = await createSellerProfile("user-1", baseData());

    const saved = prisma.sellerProfile.create.mock.calls[0][0].data;
    expect(saved.idProofNumber).toBe("ABCDE1234F");
    expect(saved.status).toBe("PENDING");
    expect(result.idProofNumber).toBe("XXXXXX234F");
  });

  it("stores only the last 4 digits of an Aadhaar number", async () => {
    const result = await createSellerProfile(
      "user-1",
      baseData({ idProofType: "AADHAAR", idProofNumber: "123456789012" })
    );

    const saved = prisma.sellerProfile.create.mock.calls[0][0].data;
    expect(saved.idProofNumber).toBe("9012");
    expect(JSON.stringify(result)).not.toContain("123456789012");
  });

  it("converts blank GST and addressLine2 to null", async () => {
    await createSellerProfile("user-1", baseData({ gstNumber: "", addressLine2: "" }));

    const saved = prisma.sellerProfile.create.mock.calls[0][0].data;
    expect(saved.gstNumber).toBeNull();
    expect(saved.addressLine2).toBeNull();
  });

  it("throws 409 when the user already has a seller profile", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({ id: "existing" });

    await expect(createSellerProfile("user-1", baseData())).rejects.toThrow(
      "Seller profile already exists"
    );
    expect(prisma.sellerProfile.create).not.toHaveBeenCalled();
  });

  it("turns a unique-constraint race (P2002) into a 409", async () => {
    prisma.sellerProfile.create.mockRejectedValue({ code: "P2002" });

    await expect(createSellerProfile("user-1", baseData())).rejects.toThrow(
      "Seller profile already exists"
    );
  });

  it("rethrows other database errors unchanged", async () => {
    const dbError = new Error("connection lost");
    prisma.sellerProfile.create.mockRejectedValue(dbError);

    await expect(createSellerProfile("user-1", baseData())).rejects.toBe(dbError);
  });
});

describe("Seller Service - getMySellerProfile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the profile with a masked ID number", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      userId: "user-1",
      idProofType: "PAN",
      idProofNumber: "ABCDE1234F",
    });

    const result = await getMySellerProfile("user-1");
    expect(result.idProofNumber).toBe("XXXXXX234F");
  });

  it("throws 404 when there is no seller profile", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue(null);

    await expect(getMySellerProfile("user-1")).rejects.toThrow("Seller profile not found");
  });
});