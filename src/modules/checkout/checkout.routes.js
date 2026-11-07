const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("./checkout.controller");
const validation = require("./checkout.validation");
const { sensitiveLimiter } = require("../payments/payments.limiter");

router.post(
  "/",
  sensitiveLimiter,
  authenticate,
  authorize("CUSTOMER"),
  validate({ body: validation.checkoutBody }),
  controller.checkout
);

module.exports = router;