const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("./reseller.controller");
const validation = require("./reseller.validation");

// A customer applies to become a reseller. Status starts as PENDING.
router.post(
  "/profile",
  authenticate,
  authorize("CUSTOMER"),
  validate({ body: validation.createProfileBody }),
  controller.createProfile
);

router.get(
  "/profile",
  authenticate,
  authorize("CUSTOMER", "RESELLER"),
  controller.getProfile
);

router.patch(
  "/profile",
  authenticate,
  authorize("CUSTOMER", "RESELLER"),
  validate({ body: validation.updateProfileBody }),
  controller.updateProfile
);

// The service also requires an APPROVED reseller profile for the routes below.
router.get(
  "/products",
  authenticate,
  authorize("CUSTOMER", "RESELLER"),
  validate({ query: validation.listProductsQuery }),
  controller.listProducts
);

router.post(
  "/shares",
  authenticate,
  authorize("CUSTOMER", "RESELLER"),
  validate({ body: validation.createShareBody }),
  controller.createShare
);

router.get(
  "/shares",
  authenticate,
  authorize("CUSTOMER", "RESELLER"),
  validate({ query: validation.listSharesQuery }),
  controller.listShares
);

router.post(
  "/margin/quote",
  authenticate,
  authorize("CUSTOMER", "RESELLER"),
  validate({ body: validation.quoteBody }),
  controller.quoteMargin
);

module.exports = router;