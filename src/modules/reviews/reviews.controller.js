const asyncHandler = require("../../utils/asyncHandler");
const service = require("./reviews.service");

// POST /api/v1/products/:productId/reviews
const createReview = asyncHandler(async (req, res) => {
  const data = await service.createReview(
    req.user,
    req.validated.params.productId,
    req.validated.body
  );

  res.status(201).json({
    success: true,
    message: "Review submitted successfully",
    data,
  });
});

// GET /api/v1/products/:productId/reviews
const listProductReviews = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;

  const data = await service.listProductReviews(
    req.validated.params.productId,
    page,
    limit
  );

  res.json({
    success: true,
    message: "Reviews fetched successfully",
    data,
  });
});

// GET /api/v1/reviews/me
const listMyReviews = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;

  const data = await service.listMyReviews(req.user, page, limit);

  res.json({
    success: true,
    message: "Your reviews fetched successfully",
    data,
  });
});

// GET /api/v1/reviews/:reviewId
const getReview = asyncHandler(async (req, res) => {
  const data = await service.getReview(req.user, req.validated.params.reviewId);

  res.json({
    success: true,
    data,
  });
});

// PATCH /api/v1/reviews/:reviewId
const updateReview = asyncHandler(async (req, res) => {
  const data = await service.updateReview(
    req.user,
    req.validated.params.reviewId,
    req.validated.body
  );

  res.json({
    success: true,
    message: "Review updated successfully",
    data,
  });
});

// DELETE /api/v1/reviews/:reviewId
const deleteReview = asyncHandler(async (req, res) => {
  await service.deleteReview(req.user, req.validated.params.reviewId);

  res.json({
    success: true,
    message: "Review deleted successfully",
  });
});

// PATCH /api/v1/admin/reviews/:reviewId/visibility  (ADMIN only)
const toggleReviewVisibility = asyncHandler(async (req, res) => {
  const data = await service.toggleReviewVisibility(
    req.validated.params.reviewId
  );

  res.json({
    success: true,
    message: `Review is now ${data.isVisible ? "visible" : "hidden"}`,
    data,
  });
});

module.exports = {
  createReview,
  listProductReviews,
  listMyReviews,
  getReview,
  updateReview,
  deleteReview,
  toggleReviewVisibility,
};
