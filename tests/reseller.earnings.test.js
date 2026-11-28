jest.mock("../src/config/db", () => ({
  prisma: {
    $transaction: jest.fn(),
    resellerProfile: {
      findUnique: jest.fn(),
    },
    resellerEarning: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    resellerEarningEvent: {
      aggregate: jest.fn(),
    },
    resellerSettlement: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const { prisma } = require("../src/config/db");
const earningsService = require("../src/modules/reseller/reseller.earnings.service");

const user = {
  id: "user_1",
  role: "CUSTOMER",
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));

  prisma.resellerProfile.findUnique.mockResolvedValue({
    id: "rp_1",
    status: "APPROVED",
  });
});

describe("reseller earnings service", () => {
  describe("getEarningsSummary", () => {
    it("returns earnings grouped by status", async () => {
      prisma.resellerEarning.groupBy.mockResolvedValue([
        { status: "PENDING", _sum: { amount: 100 }, _count: { _all: 2 } },
        { status: "ELIGIBLE", _sum: { amount: 250 }, _count: { _all: 3 } },
        { status: "IN_SETTLEMENT", _sum: { amount: 50 }, _count: { _all: 1 } },
        { status: "SETTLED", _sum: { amount: 75 }, _count: { _all: 1 } },
        { status: "CANCELLED", _sum: { amount: 25 }, _count: { _all: 1 } },
      ]);

      prisma.resellerEarningEvent.aggregate.mockResolvedValue({
        _sum: { amountDelta: -10 },
      });

      const result = await earningsService.getEarningsSummary(user);

      expect(result).toMatchObject({
        pending: 100,
        available: 250,
        inSettlement: 50,
        paid: 75,
        cancelled: 25,
        totalRecords: 8,
        adjusted: -10,
      });
    });

    it("rejects reseller who is not approved", async () => {
      prisma.resellerProfile.findUnique.mockResolvedValue({
        id: "rp_1",
        status: "PENDING",
      });

      await expect(
        earningsService.getEarningsSummary(user)
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe("listEarnings", () => {
    it("returns paginated earnings for the reseller", async () => {
      const items = [
        { id: "earning_1", amount: 500, status: "ELIGIBLE" },
      ];

      prisma.resellerEarning.findMany.mockResolvedValue(items);
      prisma.resellerEarning.count.mockResolvedValue(1);

      const result = await earningsService.listEarnings(user, {
        page: 1,
        limit: 20,
        status: "ELIGIBLE",
      });

      expect(result.items).toEqual(items);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });

      expect(prisma.resellerEarning.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resellerId: "rp_1", status: "ELIGIBLE" },
          skip: 0,
          take: 20,
        })
      );
    });
  });

  describe("listAdminSettlements", () => {
    it("filters settlements by status and resellerId", async () => {
      const items = [
        {
          id: "settlement_1",
          status: "REQUESTED",
          resellerId: "rp_1",
        },
      ];

      prisma.resellerSettlement.findMany.mockResolvedValue(items);
      prisma.resellerSettlement.count.mockResolvedValue(1);

      const result = await earningsService.listAdminSettlements({
        page: 1,
        limit: 20,
        status: "REQUESTED",
        resellerId: "rp_1",
      });

      expect(result.items).toEqual(items);
      expect(result.pagination.total).toBe(1);

      expect(prisma.resellerSettlement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "REQUESTED",
            resellerId: "rp_1",
          },
          skip: 0,
          take: 20,
        })
      );
    });
  });

  describe("requestSettlement", () => {
    it("returns existing settlement for the same reseller and idempotency key", async () => {
      const existing = {
        id: "settlement_1",
        resellerId: "rp_1",
        status: "REQUESTED",
      };

      prisma.resellerSettlement.findUnique.mockResolvedValue(existing);

      const result = await earningsService.requestSettlement(
        user,
        {},
        "idem-key-001"
      );

      expect(result).toEqual(existing);
      expect(prisma.resellerSettlement.findUnique).toHaveBeenCalledWith({
        where: { idempotencyKey: "idem-key-001" },
      });
    });

    it("rejects an idempotency key already used by another reseller", async () => {
      prisma.resellerSettlement.findUnique.mockResolvedValue({
        id: "settlement_1",
        resellerId: "another_reseller",
        status: "REQUESTED",
      });

      await expect(
        earningsService.requestSettlement(user, {}, "idem-key-001")
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });
  describe("updateAdminSettlement", () => {
    const admin = { id: "admin_1" };

      describe("updateAdminSettlement", () => {
    const admin = { id: "admin_1" };

    it("rejects invalid settlement status transition", async () => {
      prisma.resellerSettlement.findUnique.mockResolvedValue({
        id: "settlement_1",
        status: "REQUESTED",
        earnings: [],
      });

      await expect(
        earningsService.updateAdminSettlement(
          admin,
          "settlement_1",
          { status: "PAID" }
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("moves APPROVED settlement to PROCESSING", async () => {
      prisma.resellerSettlement.findUnique
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "APPROVED",
          earnings: [],
        })
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "PROCESSING",
        });

      prisma.resellerSettlement.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await earningsService.updateAdminSettlement(
        admin,
        "settlement_1",
        { status: "PROCESSING", method: "BANK_TRANSFER" }
      );

      expect(prisma.resellerSettlement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "settlement_1",
            status: "APPROVED",
          },
          data: expect.objectContaining({
            status: "PROCESSING",
            method: "BANK_TRANSFER",
          }),
        })
      );

      expect(result.status).toBe("PROCESSING");
    });

    it("marks earnings SETTLED when payout is PAID", async () => {
      const earning = {
        id: "earning_1",
        amount: 500,
        status: "IN_SETTLEMENT",
      };

      prisma.resellerSettlement.findUnique
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "PROCESSING",
          earnings: [earning],
        })
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "PAID",
        });

      prisma.resellerSettlement.updateMany.mockResolvedValue({
        count: 1,
      });

      prisma.resellerEarning.update.mockResolvedValue({});

      const result = await earningsService.updateAdminSettlement(
        admin,
        "settlement_1",
        {
          status: "PAID",
          paymentReference: "TXN-001",
          method: "BANK_TRANSFER",
        }
      );

      expect(prisma.resellerEarning.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "earning_1" },
          data: expect.objectContaining({
            status: "SETTLED",
          }),
        })
      );

      expect(result.status).toBe("PAID");
    });

    it("restores earnings to ELIGIBLE when payout fails", async () => {
      const earning = {
        id: "earning_1",
        amount: 500,
        status: "IN_SETTLEMENT",
      };

      prisma.resellerSettlement.findUnique
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "PROCESSING",
          earnings: [earning],
        })
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "FAILED",
        });

      prisma.resellerSettlement.updateMany.mockResolvedValue({
        count: 1,
      });

      prisma.resellerEarning.update.mockResolvedValue({});

      const result = await earningsService.updateAdminSettlement(
        admin,
        "settlement_1",
        {
          status: "FAILED",
          failureReason: "Bank transfer failed",
        }
      );

      expect(prisma.resellerEarning.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "earning_1" },
          data: expect.objectContaining({
            status: "ELIGIBLE",
            settlementId: null,
          }),
        })
      );

      expect(result.status).toBe("FAILED");
    });

    it("restores earnings to ELIGIBLE when settlement is REJECTED", async () => {
      const earning = {
        id: "earning_1",
        amount: 500,
        status: "IN_SETTLEMENT",
      };

      prisma.resellerSettlement.findUnique
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "REQUESTED",
          earnings: [earning],
        })
        .mockResolvedValueOnce({
          id: "settlement_1",
          status: "REJECTED",
        });

      prisma.resellerSettlement.updateMany.mockResolvedValue({
        count: 1,
      });

      prisma.resellerEarning.update.mockResolvedValue({});

      const result = await earningsService.updateAdminSettlement(
        admin,
        "settlement_1",
        {
          status: "REJECTED",
          rejectionReason: "Invalid payout details",
        }
      );

      expect(prisma.resellerEarning.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "earning_1" },
          data: expect.objectContaining({
            status: "ELIGIBLE",
            settlementId: null,
          }),
        })
      );

      expect(result.status).toBe("REJECTED");
    });
  });
  });
});
