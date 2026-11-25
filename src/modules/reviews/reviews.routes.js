const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const authorize = require("../../middilewares/authorize");
const validate = require("../../middilewares/validateRequest");

const controller = require("./reviews.controller");
const v = require("./review-validation");

// ── Public ────────────────────────────────────────────────────────────────────

// GET /api/v1/products/:productId/reviews
router.get(
  "/products/:productId/reviews",
  validate({ params: v.productIdParam, query: v.listReviewsQuery }),
  controller.listProductReviews
);

// ── Customer ──────────────────────────────────────────────────────────────────

// POST /api/v1/products/:productId/reviews
router.post(
  "/products/:productId/reviews",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: v.productIdParam, body: v.createReviewBody }),
  controller.createReview
);

// GET /api/v1/reviews/me  (must be before /:reviewId to avoid conflicts)
router.get(
  "/reviews/me",
  authenticate,
  authorize("CUSTOMER"),
  validate({ query: v.listReviewsQuery }),
  controller.listMyReviews
);

// GET /api/v1/reviews/:reviewId
router.get(
  "/reviews/:reviewId",
  authenticate,
  validate({ params: v.reviewIdParam }),
  controller.getReview
);

// PATCH /api/v1/reviews/:reviewId
router.patch(
  "/reviews/:reviewId",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: v.reviewIdParam, body: v.updateReviewBody }),
  controller.updateReview
);

// DELETE /api/v1/reviews/:reviewId
router.delete(
  "/reviews/:reviewId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  validate({ params: v.reviewIdParam }),
  controller.deleteReview
);

// ── Admin ─────────────────────────────────────────────────────────────────────

// PATCH /api/v1/admin/reviews/:reviewId/visibility
router.patch(
  "/admin/reviews/:reviewId/visibility",
  authenticate,
  authorize("ADMIN"),
  validate({ params: v.reviewIdParam }),
  controller.toggleReviewVisibility
);

module.exports = router;
