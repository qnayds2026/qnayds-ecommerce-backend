const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const c = require("../controllers/variant.controller");
const v = require("../validations/variant.validation");

router.post(
  "/products/:productId/variants",
  authenticate,
  validate({ params: v.productIdParam, body: v.createVariantBody }),
  c.create
);
router.patch(
  "/variants/:id",
  authenticate,
  validate({ params: v.idParam, body: v.updateVariantBody }),
  c.update
);

module.exports = router;