jest.mock("../src/config/db", () => ({
  prisma: {
    returnRequest: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../src/services/ownership.service", () => ({
  getApprovedSeller: jest.fn(),
}));

const { prisma } = require("../src/config/db");
const { getApprovedSeller } = require("../src/services/ownership.service");
const returnsService = require("../src/modules/returns/returns.service");
const { assertTransition, isTerminal } = require("../src/modules/returns/return-state");

const customer = { id: "user_1", role: "CUSTOMER" };
const seller = { id: "user_seller", role: "SELLER" };
const admin = { id: "user_admin", role: "ADMIN" };

const makeReturn = (overrides = {}) => ({
  id: "ret_1",
  status: "REQUESTED",
  userId: "user_1",
  ...overrides,
});

const errorOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
};

describe("return-state", () => {
  test("an impossible move is rejected (409)", () => {
    const err = errorOf(() => assertTransition("REFUNDED", "APPROVED", "ADMIN"));
    expect(err.statusCode).toBe(409);
  });

  test("a possible move by the wrong role is rejected (403)", () => {
    const err = errorOf(() => assertTransition("ITEM_RECEIVED", "REFUND_INITIATED", "SELLER"));
    expect(err.statusCode).toBe(403);
  });

  test("only the system can mark a return REFUNDED, an admin cannot (403)", () => {
    const err = errorOf(() => assertTransition("REFUND_INITIATED", "REFUNDED", "ADMIN"));
    expect(err.statusCode).toBe(403);
  });

  test("REJECTED, CANCELLED and CLOSED are final", () => {
    expect(isTerminal("REJECTED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("CLOSED")).toBe(true);
    expect(isTerminal("REQUESTED")).toBe(false);
  });
});

describe("returns.service workflow", () => {
  let tx;

  beforeEach(() => {
    jest.clearAllMocks();

    tx = {
      returnRequest: {
        findFirst: jest.fn().mockResolvedValue(makeReturn()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: "ret_1" }),
      },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    getApprovedSeller.mockResolvedValue({ id: "seller_1" });
  });

  describe("seller and admin decisions", () => {
    test("seller approves a return of their own order, audit row has the seller role", async () => {
      await returnsService.approveReturn(seller, "ret_1", "Looks fine");

      expect(tx.returnRequest.findFirst.mock.calls[0][0].where).toEqual({
        id: "ret_1",
        sellerOrder: { sellerId: "seller_1" },
      });
      const data = tx.returnRequest.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe("APPROVED");
      expect(data.sellerNote).toBe("Looks fine");
      expect(data.adminNote).toBeUndefined();
      expect(tx.returnStatusHistory.create.mock.calls[0][0].data).toMatchObject({
        oldStatus: "REQUESTED",
        newStatus: "APPROVED",
        changedBy: "user_seller",
        actorRole: "SELLER",
      });
    });

    test("another seller's return looks like a missing one (404), nothing is changed", async () => {
      tx.returnRequest.findFirst.mockResolvedValue(null);

      await expect(returnsService.approveReturn(seller, "ret_other")).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
    });

    test("admin can decide any return, no seller filter", async () => {
      await returnsService.approveReturn(admin, "ret_1");

      expect(getApprovedSeller).not.toHaveBeenCalled();
      expect(tx.returnRequest.findFirst.mock.calls[0][0].where).toEqual({ id: "ret_1" });
      expect(tx.returnStatusHistory.create.mock.calls[0][0].data.actorRole).toBe("ADMIN");
    });

    test("admin rejection keeps the note as adminNote and closes the return", async () => {
      await returnsService.rejectReturn(admin, "ret_1", "Outside policy");

      const data = tx.returnRequest.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe("REJECTED");
      expect(data.adminNote).toBe("Outside policy");
      expect(data.closedAt).toBeInstanceOf(Date);
    });

    test("a rejected return cannot be approved later (409)", async () => {
      tx.returnRequest.findFirst.mockResolvedValue(makeReturn({ status: "REJECTED" }));

      await expect(returnsService.approveReturn(admin, "ret_1")).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
    });

    test("two decisions at the same moment: the second one fails (409), no audit row", async () => {
      tx.returnRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(returnsService.approveReturn(seller, "ret_1")).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
    });
  });

  describe("customer cancel", () => {
    test("someone else's return looks like a missing one (404)", async () => {
      tx.returnRequest.findFirst.mockResolvedValue(null);

      await expect(returnsService.cancelReturn(customer, "ret_other")).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(tx.returnRequest.findFirst.mock.calls[0][0].where).toEqual({
        id: "ret_other",
        userId: "user_1",
      });
    });

    test("a requested return can be cancelled and the change is recorded", async () => {
      await returnsService.cancelReturn(customer, "ret_1", "Changed my mind");

      const data = tx.returnRequest.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe("CANCELLED");
      expect(data.closedAt).toBeInstanceOf(Date);
      expect(tx.returnStatusHistory.create.mock.calls[0][0].data).toMatchObject({
        newStatus: "CANCELLED",
        actorRole: "CUSTOMER",
        changedBy: "user_1",
      });
    });

    test("after the item is received it cannot be cancelled (409)", async () => {
      tx.returnRequest.findFirst.mockResolvedValue(makeReturn({ status: "ITEM_RECEIVED" }));

      await expect(returnsService.cancelReturn(customer, "ret_1")).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("item received", () => {
    test("seller marks an approved return as received, receivedAt is set", async () => {
      tx.returnRequest.findFirst.mockResolvedValue(makeReturn({ status: "APPROVED" }));

      await returnsService.markReceived(seller, "ret_1");

      const data = tx.returnRequest.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe("ITEM_RECEIVED");
      expect(data.receivedAt).toBeInstanceOf(Date);
      expect(data.decidedAt).toBeUndefined();
    });

    test("a return that is not approved yet cannot be marked received (409)", async () => {
      await expect(returnsService.markReceived(seller, "ret_1")).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("return shipment", () => {
    const shipment = { carrierName: "Delhivery", trackingNumber: "DL123456" };

    test("someone else's return looks like a missing one (404)", async () => {
      tx.returnRequest.findFirst.mockResolvedValue(null);

      await expect(returnsService.addShipment(customer, "ret_other", shipment)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    test("tracking details are saved on an approved return and the action is logged", async () => {
      tx.returnRequest.findFirst.mockResolvedValue(makeReturn({ status: "APPROVED" }));

      await returnsService.addShipment(customer, "ret_1", shipment);

      expect(tx.returnRequest.updateMany.mock.calls[0][0].data).toMatchObject({
        carrierName: "Delhivery",
        trackingNumber: "DL123456",
        trackingUrl: null,
      });
      expect(tx.returnStatusHistory.create.mock.calls[0][0].data.note).toContain("DL123456");
    });

    test("tracking details cannot be added before approval (409)", async () => {
      await expect(returnsService.addShipment(customer, "ret_1", shipment)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(tx.returnRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("lists", () => {
    beforeEach(() => {
      prisma.returnRequest.findMany.mockResolvedValue([]);
      prisma.returnRequest.count.mockResolvedValue(0);
    });

    test("seller only sees returns of their own seller orders", async () => {
      await returnsService.listSellerReturns(seller, { page: 1, limit: 10 });

      expect(prisma.returnRequest.findMany.mock.calls[0][0].where).toEqual({
        sellerOrder: { sellerId: "seller_1" },
      });
    });

    test("a seller who is not approved gets 403 and no data", async () => {
      getApprovedSeller.mockRejectedValue(Object.assign(new Error("Seller is not approved"), { statusCode: 403 }));

      await expect(
        returnsService.listSellerReturns(seller, { page: 1, limit: 10 })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prisma.returnRequest.findMany).not.toHaveBeenCalled();
    });

    test("admin list can be filtered by status", async () => {
      await returnsService.listAdminReturns({ status: "REFUND_FAILED", page: 2, limit: 5 });

      const args = prisma.returnRequest.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: "REFUND_FAILED" });
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
    });
  });
});