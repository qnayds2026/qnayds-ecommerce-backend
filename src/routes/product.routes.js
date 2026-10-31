const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const c = require("../controllers/product.controller");
const v = require("../validations/product.validation");

router.get("/", validate({ query: v.listProductsQuery }), c.list);
router.get("/mine", authenticate, authorize("SELLER", "ADMIN"), c.listMine); 
router.get("/:id", validate({ params: v.idParam }), c.getOne);

router.post("/", authenticate, authorize("SELLER", "ADMIN"), validate({ body: v.createProductBody }), c.create);
router.patch(
  "/:id",
  authenticate,
  authorize("SELLER", "ADMIN"),
  validate({ params: v.idParam, body: v.updateProductBody }),
  c.update
);
router.delete("/:id", authenticate, authorize("SELLER", "ADMIN"), validate({ params: v.idParam }), c.archive);

module.exports = router;