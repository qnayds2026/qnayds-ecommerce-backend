jest.mock("../src/config/db", () => {
  const tx = {
  sellerProfile: {
    update: jest.fn(),
  },
  sellerStatusHistory: {
    create: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
};

  return {
    prisma: {
      sellerProfile: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    },
    tx,
  };
});

const { prisma, tx } = require("../src/config/db");
const {
  updateSellerStatus,
  getSellerProfileById,
} = require("../src/services/seller.service");

describe("Seller Service - updateSellerStatus", () => {
  const adminId = "admin-1";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should allow PENDING to APPROVED and save history", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "PENDING",
    });

    tx.sellerProfile.update.mockResolvedValue({
      id: "seller-1",
      status: "APPROVED",
    });

    const result = await updateSellerStatus(
      "seller-1",
      "APPROVED",
      adminId
    );

    expect(result.status).toBe("APPROVED");

    expect(tx.sellerStatusHistory.create).toHaveBeenCalledWith({
      data: {
        sellerProfileId: "seller-1",
        adminId,
        fromStatus: "PENDING",
        toStatus: "APPROVED",
        reason: null,
      },
    });
  });

  test("should allow PENDING to REJECTED", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "PENDING",
    });

    tx.sellerProfile.update.mockResolvedValue({
      id: "seller-1",
      status: "REJECTED",
    });

    const result = await updateSellerStatus(
      "seller-1",
      "REJECTED",
      adminId,
      "Application does not meet requirements"
    );

    expect(result.status).toBe("REJECTED");
    expect(tx.sellerStatusHistory.create).toHaveBeenCalled();
  });

  test("should reject PENDING to REJECTED without a reason", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "PENDING",
    });

    await expect(
      updateSellerStatus("seller-1", "REJECTED", adminId)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(tx.sellerProfile.update).not.toHaveBeenCalled();
    expect(tx.sellerStatusHistory.create).not.toHaveBeenCalled();
  });

  test("should reject PENDING to REJECTED with an empty reason", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "PENDING",
    });

    await expect(
      updateSellerStatus("seller-1", "REJECTED", adminId, "   ")
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(tx.sellerProfile.update).not.toHaveBeenCalled();
    expect(tx.sellerStatusHistory.create).not.toHaveBeenCalled();
  });

  test("should allow APPROVED to SUSPENDED", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "APPROVED",
    });

    tx.sellerProfile.update.mockResolvedValue({
      id: "seller-1",
      status: "SUSPENDED",
    });

    const result = await updateSellerStatus(
      "seller-1",
      "SUSPENDED",
      adminId,
      "Policy violation"
    );

    expect(result.status).toBe("SUSPENDED");
    expect(tx.sellerStatusHistory.create).toHaveBeenCalled();
  });

  test("should allow SUSPENDED to APPROVED (reactivation)", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "SUSPENDED",
    });

    tx.sellerProfile.update.mockResolvedValue({
      id: "seller-1",
      status: "APPROVED",
    });

    const result = await updateSellerStatus(
      "seller-1",
      "APPROVED",
      adminId,
      "Issue resolved"
    );

    expect(result.status).toBe("APPROVED");
    expect(tx.sellerStatusHistory.create).toHaveBeenCalled();
  });

  test("should reject APPROVED to REJECTED", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "APPROVED",
    });

    await expect(
      updateSellerStatus("seller-1", "REJECTED", adminId)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(tx.sellerProfile.update).not.toHaveBeenCalled();
    expect(tx.sellerStatusHistory.create).not.toHaveBeenCalled();
  });

  test("should reject REJECTED to APPROVED", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue({
      id: "seller-1",
      status: "REJECTED",
    });

    await expect(
      updateSellerStatus("seller-1", "APPROVED", adminId)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(tx.sellerProfile.update).not.toHaveBeenCalled();
  });

  test("should return 404 when seller does not exist", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue(null);

    await expect(
      updateSellerStatus("seller-1", "APPROVED", adminId)
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe("Seller Service - getSellerProfileById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should return seller details with status audit history", async () => {
    const sellerData = {
      id: "seller-1",
      shopName: "Test Shop",
      status: "APPROVED",
      user: {
        id: "user-1",
        name: "Test Seller",
        email: "seller@example.com",
      },
      statusHistory: [
        {
          id: "history-1",
          fromStatus: "PENDING",
          toStatus: "APPROVED",
          reason: "Documents verified",
          createdAt: new Date(),
          admin: {
            id: "admin-1",
            name: "Admin",
            email: "admin@example.com",
          },
        },
      ],
    };

    prisma.sellerProfile.findUnique.mockResolvedValue(sellerData);

    const result = await getSellerProfileById("seller-1");

    expect(result).toEqual(sellerData);
    expect(result.statusHistory).toHaveLength(1);
    expect(result.statusHistory[0].admin.name).toBe("Admin");

    expect(prisma.sellerProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "seller-1" },
        select: expect.objectContaining({
          statusHistory: expect.any(Object),
        }),
      })
    );
  });

  test("should return 404 when seller does not exist", async () => {
    prisma.sellerProfile.findUnique.mockResolvedValue(null);

    await expect(
      getSellerProfileById("seller-1")
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
});