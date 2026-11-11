
const express = require("express");

const router = express.Router();

const authenticate = require("../../middilewares/authenticate");

const authorize = require("../../middilewares/authorize");

const validateRequest = require("../../middilewares/validateRequest");

const shippingController = require("./shipping.controller");

const {
  createShipmentBody,
  shipmentIdParam,
  updateShipmentStatusBody,
} = require("./shipping.validation");

router.post(
  "/seller/shipments",
  authenticate,
  authorize("SELLER"),
  validateRequest({
    body: createShipmentBody,
  }),
  shippingController.createShipment
);

router.get(
  "/seller/shipments",
  authenticate,
  authorize("SELLER"),
  shippingController.listSellerShipments
);

router.get(
  "/seller/shipments/:shipmentId",
  authenticate,
  authorize("SELLER"),
  validateRequest({
    params: shipmentIdParam,
  }),
  shippingController.getSellerShipment
);

router.patch(
  "/seller/shipments/:shipmentId/status",
  authenticate,
  authorize("SELLER"),
  validateRequest({
    params: shipmentIdParam,
    body: updateShipmentStatusBody,
  }),
  shippingController.updateShipmentStatus
);

module.exports = router;
