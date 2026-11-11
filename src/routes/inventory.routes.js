const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const c = require("../controllers/inventory.controller");
const v = require("../validations/inventory.validation");

router.patch(
  "/variants/:id/inventory",
  authenticate,
  authorize("SELLER", "ADMIN"),
  validate({ params: v.idParam, body: v.updateInventoryBody }),
  c.update
);

// Admin only: all inventory (?page=1&limit=10&search=TEST&lowStock=true)
router.get(
  "/inventory/admin/all",
  authenticate,
  authorize("ADMIN"),
  validate({ query: v.adminListInventoryQuery }),
  c.adminList
);

module.exports = router;