const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const c = require("../controllers/inventory.controller");
const v = require("../validations/inventory.validation");

router.patch(
  "/variants/:id/inventory",
  authenticate,
  validate({ params: v.idParam, body: v.updateInventoryBody }),
  c.update
);

module.exports = router;