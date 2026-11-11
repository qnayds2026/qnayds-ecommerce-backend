
const { z } = require("zod");

const {
  SHIPPING_STATUS_VALUES,
} = require("./shipping-status");

const createShipmentBody = z.object({
  sellerOrderId: z.string().min(1),

  carrierName: z.string().min(2).max(100),

  trackingNumber: z.string().min(2).max(100),

  trackingUrl: z.string().url().optional(),

  estimatedDeliveryAt: z.coerce.date().optional(),
});

const shipmentIdParam = z.object({
  shipmentId: z.string().min(1),
});

const updateShipmentStatusBody = z.object({
  status: z.enum(SHIPPING_STATUS_VALUES),

  description: z.string().max(500).optional(),
});

const trackingOrderIdParam = z.object({
  orderId: z.string().min(1),
});

module.exports = {
  createShipmentBody,
  shipmentIdParam,
  updateShipmentStatusBody,
  trackingOrderIdParam,
};
