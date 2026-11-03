
const { z } = require("zod");
const { ORDER_STATUS_VALUES } = require("./order-status");

const idParam = z.object({
  orderId: z.string().trim().min(1, "Order ID is required"),
});

const createOrderBody = z.object({
  addressId: z.string().trim().min(1, "Invalid address ID").optional(),
});

const updateOrderStatusBody = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
  note: z.string().trim().max(500).optional(),
});

const createShipmentBody = z.object({
  carrierName: z.string().trim().min(2).max(100),
  trackingNumber: z.string().trim().min(2).max(100),
  trackingUrl: z.string().url().optional(),
});

const cancelOrderBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

module.exports = {
  idParam,
  createOrderBody,
  updateOrderStatusBody,
  createShipmentBody,
  cancelOrderBody,
  paginationQuery,
};
