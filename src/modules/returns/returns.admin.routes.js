const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("./returns.controller");
const validation = require("./returns.validation");

router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate({ query: validation.listReturnsQuery }),
  controller.listAdminReturns
);

router.patch(
  "/:returnId/approve",
  authenticate,
  authorize("ADMIN"),
  validate({ params: validation.returnIdParams, body: validation.approveReturnBody }),
  controller.approveReturn
);

router.patch(
  "/:returnId/reject",
  authenticate,
  authorize("ADMIN"),
  validate({ params: validation.returnIdParams, body: validation.rejectReturnBody }),
  controller.rejectReturn
);
router.post(
  "/:returnId/refund",
  authenticate,
  authorize("ADMIN"),
  validate({ params: validation.returnIdParams, body: validation.refundReturnBody }),
  controller.refundReturn
);

// COD only: the admin has paid the customer manually and enters the UTR.
router.patch(
  "/:returnId/refund/confirm",
  authenticate,
  authorize("ADMIN"),
  validate({ params: validation.returnIdParams, body: validation.confirmCodRefundBody }),
  controller.confirmCodRefund
);

router.patch(
  "/:returnId/received",
  authenticate,
  authorize("ADMIN"),
  validate({ params: validation.returnIdParams, body: validation.receivedReturnBody }),
  controller.markReceived
);

router.patch(
  "/:returnId/refund/fail",
  authenticate,
  authorize("ADMIN"),
  validate({ params: validation.returnIdParams, body: validation.failCodRefundBody }),
  controller.failCodRefund
);

module.exports = router;