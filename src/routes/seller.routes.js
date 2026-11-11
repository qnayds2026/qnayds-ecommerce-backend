const router = require("express").Router();
const validate = require("../middilewares/validateRequest");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const controller = require("../controllers/seller.controller");
const v = require("../validations/seller.validation");

// Seller registration
router.post(
  "/",
  authenticate,
  validate({ body: v.createSellerBody }),
  controller.createSeller
);

// Logged-in seller views own profile
router.get("/me", authenticate, controller.getMySeller);

// Admin: list and search all sellers
router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate({ query: v.listSellerQuery }),
  controller.listSellers
);

// Admin: update seller status
router.patch(
  "/:id/status",
  authenticate,
  authorize("ADMIN"),
  validate({ params: v.idParam, body: v.updateStatusBody }),
  controller.updateSellerStatus
);

// Admin: view seller details
router.get(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate({ params: v.idParam }),
  controller.getSellerDetails
);

module.exports = router;