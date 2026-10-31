const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const c = require("../controllers/image.controller");
const v = require("../validations/image.validation");

router.post(
  "/products/:productId/images",
  authenticate,
  authorize("SELLER", "ADMIN"),
  validate({ params: v.productIdParam, body: v.createImageBody }),
  c.add
);
router.patch(
  "/images/:id",
  authenticate,
  authorize("SELLER", "ADMIN"),
  validate({ params: v.idParam, body: v.updateImageBody }),
  c.update
);
router.delete(
  "/images/:id",
  authenticate,
  authorize("SELLER", "ADMIN"),
  validate({ params: v.idParam }),
  c.remove
);

module.exports = router;