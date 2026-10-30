const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const { authenticate } = require("../middilewares/auth");
const c = require("../controllers/image.controller");
const v = require("../validations/image.validation");

router.post(
  "/products/:productId/images",
  authenticate,
  validate({ params: v.productIdParam, body: v.createImageBody }),
  c.add
);
router.patch(
  "/images/:id",
  authenticate,
  validate({ params: v.idParam, body: v.updateImageBody }),
  c.update
);
router.delete(
  "/images/:id",
  authenticate,
  validate({ params: v.idParam }),
  c.remove
);

module.exports = router;