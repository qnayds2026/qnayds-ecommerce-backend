const { z } = require("zod");

const productIdParam = z.object({
  productId: z.string().trim().min(1, "Product ID is required"),
});

const reviewIdParam = z.object({
  reviewId: z.string().trim().min(1, "Review ID is required"),
});

const createReviewBody = z.object({
  orderId: z.string().trim().min(1, "Order ID is required"),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(150).optional(),
  body: z.string().trim().max(2000).optional(),
});

const updateReviewBody = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    title: z.string().trim().max(150).optional(),
    body: z.string().trim().max(2000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

const listReviewsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

module.exports = {
  productIdParam,
  reviewIdParam,
  createReviewBody,
  updateReviewBody,
  listReviewsQuery,
};
