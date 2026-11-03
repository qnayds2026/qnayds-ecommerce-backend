const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("./payments.controller");
const validation = require("./payments.validation");
const { sensitiveLimiter } = require("./payments.limiter");

router.post(
  "/razorpay/order",
  sensitiveLimiter,
  authenticate,
  authorize("CUSTOMER"),
  validate({ body: validation.createRazorpayOrderBody }),
  controller.createRazorpayOrder
);

router.post(
  "/razorpay/verify",
  sensitiveLimiter,
  authenticate,
  authorize("CUSTOMER"),
  validate({ body: validation.verifyPaymentBody }),
  controller.verifyPayment
);

router.get(
  "/:paymentId",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: validation.paymentIdParam }),
  controller.getPayment
);

router.post(
  "/:paymentId/retry",
  sensitiveLimiter,
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: validation.paymentIdParam }),
  controller.retryPayment
);

module.exports = router;