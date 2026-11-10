
const shippingService = require("../../services/shipping.service");

async function createShipment(req, res, next) {
  try {
    const shipment = await shippingService.createShipment(
      req.user,
      req.validated.body
    );

    return res.status(201).json({
      success: true,
      message: "Shipment created successfully",
      data: shipment,
    });
  } catch (error) {
    next(error);
  }
}

async function updateShipmentStatus(req, res, next) {
  try {
    const shipment =
      await shippingService.updateShipmentStatus(
        req.user,
        req.validated.params.shipmentId,
        req.validated.body
      );

    return res.status(200).json({
      success: true,
      message: "Shipment status updated",
      data: shipment,
    });
  } catch (error) {
    next(error);
  }
}

async function listSellerShipments(req, res, next) {
  try {
    const shipments =
      await shippingService.getSellerShipments(
        req.user
      );

    return res.status(200).json({
      success: true,
      data: shipments,
    });
  } catch (error) {
    next(error);
  }
}

async function getSellerShipment(req, res, next) {
  try {
    const shipment =
      await shippingService.getSellerShipmentById(
        req.user,
        req.validated.params.shipmentId
      );

    return res.status(200).json({
      success: true,
      data: shipment,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createShipment,
  updateShipmentStatus,
  listSellerShipments,
  getSellerShipment,
};
