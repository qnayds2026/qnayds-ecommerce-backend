
jest.mock("../src/config/db", () => ({
  prisma: {
    $transaction: jest.fn(),
    sellerProfile: {
      findUnique: jest.fn(),
    },
    sellerOrder: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    shipment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    shipmentEvent: {
      create: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    orderStatusHistory: {
      create: jest.fn(),
    },
  },
}));

jest.mock("../src/modules/notifications/notifications.service", () => ({
  createManyNotifications: jest.fn(),
}));

const { prisma } = require("../src/config/db");
const {
  createManyNotifications,
} = require("../src/modules/notifications/notifications.service");

const shippingService = require("../src/services/shipping.service");

const user = {
  id: "seller_user_1",
  role: "SELLER",
};

const seller = {
  id: "seller_1",
  userId: user.id,
};

beforeEach(() => {
  jest.clearAllMocks();

  prisma.$transaction.mockImplementation(async (callback) =>
    callback(prisma)
  );

  prisma.sellerProfile.findUnique.mockResolvedValue(seller);
});

describe("shipping service", () => {
  describe("createShipment", () => {
    const data = {
      sellerOrderId: "seller_order_1",
      carrierName: "Delhivery",
      trackingNumber: "AWB123456",
      trackingUrl: "https://tracking.example.com/AWB123456",
    };

    it("creates shipment for seller's own order", async () => {
      const shipment = {
        id: "shipment_1",
        sellerOrderId: "seller_order_1",
        status: "READY_TO_SHIP",
      };

      prisma.sellerOrder.findFirst.mockResolvedValue({
        id: "seller_order_1",
        status: "CONFIRMED",
        shipment: null,
      });

      prisma.shipment.create.mockResolvedValue(shipment);

      const result = await shippingService.createShipment(user, data);

      expect(result).toEqual(shipment);

      expect(prisma.sellerOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "seller_order_1",
            sellerId: "seller_1",
          },
        })
      );

      expect(prisma.shipment.create).toHaveBeenCalled();
      expect(prisma.shipmentEvent.create).toHaveBeenCalled();
    });

    it("rejects shipment creation for another seller's order", async () => {
      prisma.sellerOrder.findFirst.mockResolvedValue(null);

      await expect(
        shippingService.createShipment(user, data)
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(prisma.shipment.create).not.toHaveBeenCalled();
    });

    it("rejects duplicate shipment creation", async () => {
      prisma.sellerOrder.findFirst.mockResolvedValue({
        id: "seller_order_1",
        status: "CONFIRMED",
        shipment: {
          id: "existing_shipment",
        },
      });

      await expect(
        shippingService.createShipment(user, data)
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(prisma.shipment.create).not.toHaveBeenCalled();
    });

    it("rejects shipment for an ineligible seller order", async () => {
      prisma.sellerOrder.findFirst.mockResolvedValue({
        id: "seller_order_1",
        status: "DELIVERED",
        shipment: null,
      });

      await expect(
        shippingService.createShipment(user, data)
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(prisma.shipment.create).not.toHaveBeenCalled();
    });
  });

  describe("getSellerShipments", () => {
    it("returns only the logged-in seller's shipments", async () => {
      const shipments = [{ id: "shipment_1" }];

      prisma.shipment.findMany.mockResolvedValue(shipments);

      const result = await shippingService.getSellerShipments(user);

      expect(result).toEqual(shipments);

      expect(prisma.shipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sellerOrder: {
              sellerId: "seller_1",
            },
          },
        })
      );
    });
  });

  describe("getSellerShipmentById", () => {
    it("returns shipment belonging to the seller", async () => {
      const shipment = {
        id: "shipment_1",
        status: "READY_TO_SHIP",
      };

      prisma.shipment.findFirst.mockResolvedValue(shipment);

      const result = await shippingService.getSellerShipmentById(
        user,
        "shipment_1"
      );

      expect(result).toEqual(shipment);

      expect(prisma.shipment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "shipment_1",
            sellerOrder: {
              sellerId: "seller_1",
            },
          },
        })
      );
    });

    it("rejects access to another seller's shipment", async () => {
      prisma.shipment.findFirst.mockResolvedValue(null);

      await expect(
        shippingService.getSellerShipmentById(user, "other_shipment")
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("updateShipmentStatus", () => {
    it("rejects access to another seller's shipment", async () => {
      prisma.shipment.findFirst.mockResolvedValue(null);

      await expect(
        shippingService.updateShipmentStatus(
          user,
          "other_shipment",
          { status: "SHIPPED" }
        )
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects invalid shipment status transition", async () => {
      prisma.shipment.findFirst.mockResolvedValue({
        id: "shipment_1",
        status: "DELIVERED",
        sellerOrder: {
          id: "seller_order_1",
          sellerId: "seller_1",
          orderId: "order_1",
          status: "DELIVERED",
          order: {
            userId: "customer_1",
            orderNumber: "ORD001",
          },
        },
      });

      await expect(
        shippingService.updateShipmentStatus(
          user,
          "shipment_1",
          { status: "SHIPPED" }
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    });

    it("updates shipment and seller order to SHIPPED", async () => {
      prisma.shipment.findFirst.mockResolvedValue({
        id: "shipment_1",
        status: "PACKED",
        sellerOrder: {
          id: "seller_order_1",
          sellerId: "seller_1",
          orderId: "order_1",
          status: "PROCESSING",
          order: {
            userId: "customer_1",
            orderNumber: "ORD001",
          },
        },
      });

      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      prisma.sellerOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUnique.mockResolvedValue({ status: "PROCESSING" });
      prisma.sellerOrder.findMany.mockResolvedValue([
        { status: "SHIPPED" },
      ]);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const updatedShipment = {
        id: "shipment_1",
        status: "SHIPPED",
      };

      prisma.shipment.findUnique.mockResolvedValue(updatedShipment);

      const result = await shippingService.updateShipmentStatus(
        user,
        "shipment_1",
        { status: "SHIPPED", description: "Handed to carrier" }
      );

      expect(result).toEqual(updatedShipment);
      expect(prisma.shipment.updateMany).toHaveBeenCalled();
      expect(prisma.sellerOrder.updateMany).toHaveBeenCalled();
      expect(prisma.shipmentEvent.create).toHaveBeenCalled();
      expect(prisma.order.updateMany).toHaveBeenCalled();
    });

    it("updates order and notifies customer when shipment is DELIVERED", async () => {
      prisma.shipment.findFirst.mockResolvedValue({
        id: "shipment_1",
        status: "OUT_FOR_DELIVERY",
        sellerOrder: {
          id: "seller_order_1",
          sellerId: "seller_1",
          orderId: "order_1",
          status: "SHIPPED",
          order: {
            userId: "customer_1",
            orderNumber: "ORD001",
          },
        },
      });

      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      prisma.sellerOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUnique.mockResolvedValue({ status: "SHIPPED" });
      prisma.sellerOrder.findMany.mockResolvedValue([
        { status: "DELIVERED" },
      ]);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const updatedShipment = {
        id: "shipment_1",
        status: "DELIVERED",
      };

      prisma.shipment.findUnique.mockResolvedValue(updatedShipment);

      const result = await shippingService.updateShipmentStatus(
        user,
        "shipment_1",
        { status: "DELIVERED", description: "Delivered successfully" }
      );

      expect(result).toEqual(updatedShipment);
      expect(prisma.sellerOrder.updateMany).toHaveBeenCalled();
      expect(prisma.order.updateMany).toHaveBeenCalled();
      expect(prisma.orderStatusHistory.create).toHaveBeenCalled();

      expect(createManyNotifications).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            userId: "customer_1",
            type: "ORDER_DELIVERED",
          }),
        ])
      );
    });

    it("rejects concurrent shipment status updates", async () => {
      prisma.shipment.findFirst.mockResolvedValue({
        id: "shipment_1",
        status: "PACKED",
        sellerOrder: {
          id: "seller_order_1",
          sellerId: "seller_1",
          orderId: "order_1",
          status: "PROCESSING",
          order: {
            userId: "customer_1",
            orderNumber: "ORD001",
          },
        },
      });

      prisma.shipment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        shippingService.updateShipmentStatus(
          user,
          "shipment_1",
          { status: "SHIPPED" }
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(prisma.sellerOrder.updateMany).not.toHaveBeenCalled();
    });
  });
});
