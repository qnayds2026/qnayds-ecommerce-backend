jest.mock("../src/config/db", () => ({
  prisma: {
    resellerProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const { prisma } = require("../src/config/db");
const resellerService = require("../src/modules/reseller/reseller.service");
const validation = require("../src/modules/reseller/reseller.validation");

const user = { id: "user_1", role: "CUSTOMER" };

const profile = (overrides = {}) => ({
  id: "rp_1",
  displayName: "Test Reseller",
  phone: null,
  status: "PENDING",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("reseller.service createProfile", () => {
  it("creates a PENDING profile for the logged-in user", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue(null);
    prisma.resellerProfile.create.mockResolvedValue(profile());

    const result = await resellerService.createProfile(user, {
      displayName: "Test Reseller",
    });

    expect(result.status).toBe("PENDING");
    const arg = prisma.resellerProfile.create.mock.calls[0][0];
    expect(arg.data.userId).toBe("user_1");
    expect(arg.data.phone).toBeNull();
    expect(arg.data).not.toHaveProperty("status");
  });

  it("rejects a second profile for the same user with 409", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue({ id: "rp_1" });

    await expect(
      resellerService.createProfile(user, { displayName: "Again" })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.resellerProfile.create).not.toHaveBeenCalled();
  });

  it("does not select userId or any bank field in the response", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue(null);
    prisma.resellerProfile.create.mockResolvedValue(profile());

    await resellerService.createProfile(user, { displayName: "Test Reseller" });

    const select = prisma.resellerProfile.create.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("userId");
    expect(select).not.toHaveProperty("bankAccounts");
  });
});

describe("reseller.service getProfile", () => {
  it("looks up only the logged-in user's own profile", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue(profile());

    await resellerService.getProfile(user);

    expect(prisma.resellerProfile.findUnique.mock.calls[0][0].where).toEqual({
      userId: "user_1",
    });
  });

  it("throws 404 when the user has no profile", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue(null);

    await expect(resellerService.getProfile(user)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("reseller.service updateProfile", () => {
  it("updates only the provided fields", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue({
      id: "rp_1",
      status: "PENDING",
    });
    prisma.resellerProfile.update.mockResolvedValue(
      profile({ phone: "9876543210" })
    );

    const result = await resellerService.updateProfile(user, {
      phone: "9876543210",
    });

    expect(result.phone).toBe("9876543210");
    const arg = prisma.resellerProfile.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "rp_1" });
    expect(arg.data).toEqual({ phone: "9876543210" });
  });

  it("throws 404 when the user has no profile", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue(null);

    await expect(
      resellerService.updateProfile(user, { phone: "9876543210" })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.resellerProfile.update).not.toHaveBeenCalled();
  });

  it("blocks a suspended reseller with 403", async () => {
    prisma.resellerProfile.findUnique.mockResolvedValue({
      id: "rp_1",
      status: "SUSPENDED",
    });

    await expect(
      resellerService.updateProfile(user, { displayName: "New Name" })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.resellerProfile.update).not.toHaveBeenCalled();
  });
});

describe("reseller.validation", () => {
  it("accepts a valid create body", () => {
    const result = validation.createProfileBody.safeParse({
      displayName: "Test Reseller",
      phone: "9876543210",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a display name shorter than 2 characters", () => {
    const result = validation.createProfileBody.safeParse({ displayName: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key such as status", () => {
    const result = validation.createProfileBody.safeParse({
      displayName: "Test",
      status: "APPROVED",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid phone number", () => {
    const result = validation.createProfileBody.safeParse({
      displayName: "Test",
      phone: "12345",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty update body", () => {
    const result = validation.updateProfileBody.safeParse({});
    expect(result.success).toBe(false);
  });

  it("allows clearing the phone number on update", () => {
    const result = validation.updateProfileBody.safeParse({ phone: null });
    expect(result.success).toBe(true);
  });
});