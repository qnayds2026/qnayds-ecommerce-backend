const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("../../controllers/orders.controller");
const validation = require("./order-validation");

router.get(
  "/seller/orders",
  authenticate,
  authorize("SELLER"),
  validate({ query: validation.paginationQuery }),
  controller.listSellerOrders
);

router.get(
  "/seller/orders/:orderId",
  authenticate,
  authorize("SELLER"),
  validate({ params: validation.idParam }),
  controller.getSellerOrder
);

router.patch(
  "/seller/orders/:orderId/status",
  authenticate,
  authorize("SELLER"),
  validate({
    params: validation.idParam,
    body: validation.updateOrderStatusBody,
  }),
  controller.updateSellerOrderStatus
);

router.post(
  "/seller/orders/:orderId/shipment",
  authenticate,
  authorize("SELLER"),
  validate({
    params: validation.idParam,
    body: validation.createShipmentBody,
  }),
  controller.createSellerShipment
);

router.post(
  "/orders",
  authenticate,
  authorize("CUSTOMER"),
  validate({ body: validation.createOrderBody }),
  controller.createOrder
);

router.get(
  "/orders",
  authenticate,
  authorize("CUSTOMER"),
  validate({ query: validation.paginationQuery }),
  controller.listCustomerOrders
);

// Admin only: all orders (?page=1&limit=10&status=SHIPPED&search=QO-)
router.get(
  "/orders/admin/all",
  authenticate,
  authorize("ADMIN"),
  validate({ query: validation.adminListOrdersQuery }),
  controller.adminListOrders
);

router.get(
  "/orders/:orderId/tracking",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: validation.idParam }),
  controller.getCustomerOrderTracking
);

router.post(
  "/orders/:orderId/cancel",
  authenticate,
  authorize("CUSTOMER"),
  validate({
    params: validation.idParam,
    body: validation.cancelOrderBody,
  }),
  controller.cancelCustomerOrder
);

router.get(
  "/orders/:orderId",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: validation.idParam }),
  controller.getCustomerOrder
);

module.exports = router;