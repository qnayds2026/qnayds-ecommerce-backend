const asyncHandler = require("../utils/asyncHandler");
const service = require("../services/orders.service");
const shippingService = require("../services/shipping.service");

const listSellerOrders = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;

  const data = await service.listSellerOrders(
    req.user,
    page,
    limit
  );

  res.json({
    success: true,
    message: "Seller orders fetched successfully",
    data,
  });
});

const getSellerOrder = asyncHandler(async (req, res) => {
  const data = await service.getSellerOrderById(
    req.user,
    req.validated.params.orderId
  );

  res.json({
    success: true,
    data,
  });
});

const updateSellerOrderStatus = asyncHandler(async (req, res) => {
  const data = await service.updateSellerOrderStatus(
    req.user,
    req.validated.params.orderId,
    req.validated.body
  );

  res.json({
    success: true,
    message: "Seller order status updated successfully",
    data,
  });
});

const createSellerShipment = asyncHandler(async (req, res) => {
  const data = await shippingService.createShipment(req.user, {
    ...req.validated.body,
    sellerOrderId: req.validated.params.orderId,
  });

  res.status(201).json({
    success: true,
    message: "Shipment created successfully",
    data,
  });
});


const createOrder = asyncHandler(async (req, res) => {
  const data = await service.createOrder(
    req.user,
    req.validated.body,
    req.get("Idempotency-Key")
  );

  res.status(201).json({
    success: true,
    message: "Order created successfully",
    data,
  });
});


const listCustomerOrders = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;

  const data = await service.listCustomerOrders(
    req.user,
    page,
    limit
  );

  res.json({
    success: true,
    message: "Customer orders fetched successfully",
    data,
  });
});

const getCustomerOrder = asyncHandler(async (req, res) => {
  const data = await service.getCustomerOrderById(
    req.user,
    req.validated.params.orderId
  );

  res.json({
    success: true,
    message: "Order details fetched successfully",
    data,
  });
});

const getCustomerOrderTracking = asyncHandler(async (req, res) => {
  const data = await service.getCustomerOrderTracking(
    req.user,
    req.validated.params.orderId
  );

  res.json({
    success: true,
    message: "Order tracking details fetched successfully",
    data,
  });
});

const cancelCustomerOrder = asyncHandler(async (req, res) => {
  const data = await service.cancelCustomerOrder(
    req.user,
    req.validated.params.orderId,
    req.validated.body
  );

  res.json({
    success: true,
    message: "Order cancelled successfully",
    data,
  });
});

module.exports = {
  createOrder,
  listSellerOrders,
  getSellerOrder,
  updateSellerOrderStatus,
  createSellerShipment,
  listCustomerOrders,
  getCustomerOrder,
  getCustomerOrderTracking,
  cancelCustomerOrder,
};