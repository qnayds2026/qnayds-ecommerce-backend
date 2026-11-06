const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("./returns.controller");
const validation = require("./returns.validation");

router.get(
  "/",
  authenticate,
  authorize("SELLER"),
  validate({ query: validation.listReturnsQuery }),
  controller.listSellerReturns
);

router.patch(
  "/:returnId/approve",
  authenticate,
  authorize("SELLER"),
  validate({ params: validation.returnIdParams, body: validation.approveReturnBody }),
  controller.approveReturn
);

router.patch(
  "/:returnId/reject",
  authenticate,
  authorize("SELLER"),
  validate({ params: validation.returnIdParams, body: validation.rejectReturnBody }),
  controller.rejectReturn
);
router.patch(
  "/:returnId/received",
  authenticate,
  authorize("SELLER"),
  validate({ params: validation.returnIdParams, body: validation.receivedReturnBody }),
  controller.markReceived
);
module.exports = router;