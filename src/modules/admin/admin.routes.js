
const express = require("express");
const router = express.Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validate");

const adminController = require("./admin.controller");
const sellerController = require("../../controllers/seller.controller");
const sellerValidation = require("../../validations/seller.validation");
const categoryController = require("../../controllers/category.controller");
const categoryValidation = require("../../validations/category.validation");

const {
  dashboardQuery,
  listCustomersQuery,
  listAdminProductsQuery,
  updateProductStatusBody,
  updateCustomerStatusBody,
  listAdminOrdersQuery,
  salesReportQuery,
  listAdminShipmentsQuery,
  adminShipmentIdParam,
  adminUpdateShipmentStatusBody,
} = require("./admin.validation");
// Admin dashboard
router.get(
  "/dashboard",
  authenticate,
  authorize("ADMIN"),
  validate({ query: dashboardQuery }),
  adminController.getDashboard
);

// Admin customer management
router.get(
  "/customers",
  authenticate,
  authorize("ADMIN"),
  validate({ query: listCustomersQuery }),
  adminController.listCustomers
);

// Admin seller management
router.get(
  "/sellers",
  authenticate,
  authorize("ADMIN"),
  validate({ query: sellerValidation.listSellerQuery }),
  sellerController.listSellers
);

router.get(
  "/sellers/:id",
  authenticate,
  authorize("ADMIN"),
  validate({ params: sellerValidation.idParam }),
  sellerController.getSellerDetails
);

router.patch(
  "/sellers/:id/status",
  authenticate,
  authorize("ADMIN"),
  validate({
    params: sellerValidation.idParam,
    body: sellerValidation.updateStatusBody,
  }),
  sellerController.updateSellerStatus
);

// Admin category management
router.get(
  "/categories",
  authenticate,
  authorize("ADMIN"),
  validate({ query: categoryValidation.listAdminCategoriesQuery }),
  categoryController.listAdmin
);

router.post(
  "/categories",
  authenticate,
  authorize("ADMIN"),
  validate({ body: categoryValidation.createCategoryBody }),
  categoryController.create
);

router.patch(
  "/categories/:id",
  authenticate,
  authorize("ADMIN"),
  validate({
    params: categoryValidation.idParam,
    body: categoryValidation.updateCategoryBody,
  }),
  categoryController.update
);

// Admin customer status management
router.patch(
  "/customers/:id/status",
  authenticate,
  authorize("ADMIN"),
  validate({
    params: require("zod").z.object({
      id: require("zod").z.string().trim().min(1, "Customer ID is required"),
    }),
    body: updateCustomerStatusBody,
  }),
  adminController.updateCustomerStatus
);

// Admin product management
router.get(
  "/products",
  authenticate,
  authorize("ADMIN"),
  validate({ query: listAdminProductsQuery }),
  adminController.listProducts
);

// Admin product moderation
router.patch(
  "/products/:id/status",
  authenticate,
  authorize("ADMIN"),
  validate({
    params: require("zod").z.object({
      id: require("zod").z.string().trim().min(1, "Product ID is required"),
    }),
    body: updateProductStatusBody,
  }),
  adminController.updateProductStatus
);

// Admin order management
router.get(
  "/orders",
  authenticate,
  authorize("ADMIN"),
  validate({ query: listAdminOrdersQuery }),
  adminController.listOrders
);

router.get(
  "/orders/:id",
  authenticate,
  authorize("ADMIN"),
validate({
  params: require("zod").z.object({
    id: require("zod").z.string().trim().min(1, "Order ID is required"),
  }),
}),  adminController.getOrderDetails
);

// Admin shipment management
router.get(
  "/shipments",
  authenticate,
  authorize("ADMIN"),
  validate({ query: listAdminShipmentsQuery }),
  adminController.listShipments
);

router.patch(
  "/shipments/:shipmentId/status",
  authenticate,
  authorize("ADMIN"),
  validate({
    params: adminShipmentIdParam,
    body: adminUpdateShipmentStatusBody,
  }),
  adminController.updateShipmentStatus
);

router.get(
  "/reports/sales",
  authenticate,
  authorize("ADMIN"),
  validate({ query: salesReportQuery }),
  adminController.getSalesReport
);

module.exports = router;
