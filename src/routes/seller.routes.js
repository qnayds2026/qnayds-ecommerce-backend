const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const controller = require("../controllers/seller.controller");
const v = require("../validations/seller.validation");

router.post(
  "/",
  authenticate,
  validate({ body: v.createSellerBody }),
  controller.createSeller
);

router.get("/me", authenticate, controller.getMySeller);

// Admin only: list sellers (?status=PENDING)
// Keep this after "/me" so "me" is never treated as an id
router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate({ query: v.listSellersQuery }),
  controller.listSellers
);

router.patch(
  "/:id/status",
  authenticate,
  authorize("ADMIN"),
  validate({ params: v.idParam, body: v.updateStatusBody }),
  controller.updateSellerStatus
);

module.exports = router;