
const asyncHandler = require("../../utils/asyncHandler");
const adminService = require("./admin.service");

async function getDashboard(req, res) {
  const data = await adminService.getDashboardSummary(
    req.validated.query
  );

  return res.status(200).json({
    success: true,
    message: "Admin dashboard fetched successfully",
    data,
  });
}

async function listCustomers(req, res) {
  const data = await adminService.listCustomers(req.validated.query);

  return res.status(200).json({
    success: true,
    message: "Customers fetched successfully",
    data,
  });
}

async function listProducts(req, res) {
  const data = await adminService.listAdminProducts(req.validated.query);

  return res.status(200).json({
    success: true,
    message: "Products fetched successfully",
    data,
  });
}

async function updateProductStatus(req, res) {
  const data = await adminService.updateProductStatus(
    req.validated.params.id,
    req.validated.body.status,
    req.user.id,
    req.validated.body.reason
  );

  return res.status(200).json({
    success: true,
    message: "Product status updated successfully",
    data,
  });
}

async function listOrders(req, res) {
  const data = await adminService.listAdminOrders(req.validated.query);

  return res.status(200).json({
    success: true,
    message: "Orders fetched successfully",
    data,
  });
}

async function getOrderDetails(req, res) {
  const data = await adminService.getAdminOrderDetails(
    req.validated.params.id
  );

  return res.status(200).json({
    success: true,
    message: "Order details fetched successfully",
    data,
  });
}

async function getSalesReport(req, res) {
  const data = await adminService.getSalesReport(req.validated.query);

  return res.status(200).json({
    success: true,
    message: "Sales report fetched successfully",
    data,
  });
}

async function updateCustomerStatus(req, res) {
  const data = await adminService.updateCustomerStatus(
    req.validated.params.id,
    req.validated.body.status,
    req.user.id,
    req.validated.body.reason
  );

  return res.status(200).json({
    success: true,
    message: "Customer status updated successfully",
    data,
  });
}

async function listShipments(req, res) {
  const data = await adminService.listAdminShipments(
    req.validated.query
  );

  return res.status(200).json({
    success: true,
    message: "Shipments fetched successfully",
    data,
  });
}

async function updateShipmentStatus(req, res) {
  const data = await adminService.updateAdminShipmentStatus(
    req.user,
    req.validated.params.shipmentId,
    req.validated.body
  );

  return res.status(200).json({
    success: true,
    message: "Shipment status updated successfully",
    data,
  });
}

module.exports = {
  getDashboard: asyncHandler(getDashboard),
  listCustomers: asyncHandler(listCustomers),
  listProducts: asyncHandler(listProducts),
  updateProductStatus: asyncHandler(updateProductStatus),
  listOrders: asyncHandler(listOrders),
  getOrderDetails: asyncHandler(getOrderDetails),
  updateCustomerStatus: asyncHandler(updateCustomerStatus),
  getSalesReport: asyncHandler(getSalesReport),
  listShipments,
  updateShipmentStatus,
};
