const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const c = require("../controllers/variant.controller");
const v = require("../validations/variant.validation");

router.post(
  "/products/:productId/variants",
  authenticate,
  authorize("SELLER", "ADMIN"),
  validate({ params: v.productIdParam, body: v.createVariantBody }),
  c.create
);
router.patch(
  "/variants/:id",
  authenticate,
  authorize("SELLER", "ADMIN"),
  validate({ params: v.idParam, body: v.updateVariantBody }),
  c.update
);

module.exports = router;