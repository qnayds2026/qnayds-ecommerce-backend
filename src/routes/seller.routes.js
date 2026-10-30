const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const { authenticate, authorize } = require("../middilewares/auth");
const controller = require("../controllers/seller.controller");
const v = require("../validations/seller.validation");

router.post(
  "/",
  authenticate,
  validate({ body: v.createSellerBody }),
  controller.createSeller
);

router.get("/me", authenticate, controller.getMySeller);

router.patch(
  "/:id/status",
  authenticate,
  authorize("ADMIN"),
  validate({ params: v.idParam, body: v.updateStatusBody }),
  controller.updateSellerStatus
);

module.exports = router;