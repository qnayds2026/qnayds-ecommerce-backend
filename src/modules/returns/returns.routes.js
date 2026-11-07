const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("./returns.controller");
const validation = require("./returns.validation");

// Customer requests a return for delivered items of their own order.
router.post(
  "/",
  authenticate,
  authorize("CUSTOMER"),
  validate({ body: validation.createReturnBody }),
  controller.createReturn
);

// Must stay above "/:returnId", otherwise "my" is read as an id.
router.get(
  "/my",
  authenticate,
  authorize("CUSTOMER"),
  validate({ query: validation.listReturnsQuery }),
  controller.listMyReturns
);

router.get(
  "/:returnId",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: validation.returnIdParams }),
  controller.getMyReturn
);

router.patch(
  "/:returnId/cancel",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: validation.returnIdParams, body: validation.cancelReturnBody }),
  controller.cancelReturn
);

// Customer adds the courier details of the parcel being sent back.
router.patch(
  "/:returnId/shipment",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: validation.returnIdParams, body: validation.shipmentBody }),
  controller.addShipment
);

module.exports = router;