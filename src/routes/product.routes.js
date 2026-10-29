const router = require("express").Router();
const validate = require("../middilewares/validate");
const { authenticate } = require("../middilewares/auth");
const c = require("../controllers/product.controller");
const v = require("../validations/product.validation");

router.get("/", validate({ query: v.listProductsQuery }), c.list);
router.get("/mine", authenticate, c.listMine); // "/:id"-inu mumbu aayirikkanam
router.get("/:id", validate({ params: v.idParam }), c.getOne);

router.post("/", authenticate, validate({ body: v.createProductBody }), c.create);
router.patch(
  "/:id",
  authenticate,
  validate({ params: v.idParam, body: v.updateProductBody }),
  c.update
);
router.delete("/:id", authenticate, validate({ params: v.idParam }), c.archive);

module.exports = router;