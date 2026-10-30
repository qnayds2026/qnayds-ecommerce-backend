const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const c = require("../controllers/category.controller");
const v = require("../validations/category.validation");

router.get("/", c.list);
router.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate({ body: v.createCategoryBody }),
  c.create
);
router.patch(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate({ params: v.idParam, body: v.updateCategoryBody }),
  c.update
);

module.exports = router;