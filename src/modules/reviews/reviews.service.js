const { prisma } = require("../../config/db");
const ApiError = require("../../utils/ApiError");

/**
 * Create a review.
 * Rules:
 *  - The customer must have an order that contains the product and is DELIVERED.
 *  - One review per (user, product, order).
 */
async function createReview(user, productId, body) {
  const { orderId, rating, title, body: reviewBody } = body;

  // Verify the order belongs to this customer and is delivered
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId: user.id,
      status: "DELIVERED",
    },
    include: {
      orderItems: {
        where: { variant: { productId } },
        include: { variant: { select: { productId: true } } },
      },
    },
  });

  if (!order) {
    throw ApiError.notFound("Order not found or not yet delivered");
  }

  if (order.orderItems.length === 0) {
    throw ApiError.badRequest("This product was not part of that order");
  }

  // Check product exists and is active
  const product = await prisma.product.findFirst({
    where: { id: productId, status: "ACTIVE" },
    select: { id: true },
  });

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  // Duplicate check (unique constraint will also catch it, but give a nicer message)
  const existing = await prisma.review.findUnique({
    where: {
      userId_productId_orderId: {
        userId: user.id,
        productId,
        orderId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    throw ApiError.conflict("You have already reviewed this product for this order");
  }

  const review = await prisma.review.create({
    data: {
      userId: user.id,
      productId,
      orderId,
      rating,
      title: title || null,
      body: reviewBody || null,
    },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  return review;
}

/**
 * List visible reviews for a product with pagination and summary stats.
 */
async function listProductReviews(productId, page, limit) {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: "ACTIVE" },
    select: { id: true },
  });

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const skip = (page - 1) * limit;

  const [reviews, total, stats] = await Promise.all([
    prisma.review.findMany({
      where: { productId, isVisible: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.review.count({ where: { productId, isVisible: true } }),
    prisma.review.aggregate({
      where: { productId, isVisible: true },
      _avg: { rating: true },
      _count: { rating: true },
    }),
  ]);

  return {
    reviews,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      averageRating: stats._avg.rating
        ? parseFloat(stats._avg.rating.toFixed(1))
        : null,
      totalReviews: stats._count.rating,
    },
  };
}

/**
 * Get a single review by ID (must belong to the requesting user or be an admin).
 */
async function getReview(user, reviewId) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  if (!review) {
    throw ApiError.notFound("Review not found");
  }

  // Customers can only see their own hidden reviews; admins see all
  if (!review.isVisible && user.role !== "ADMIN" && review.userId !== user.id) {
    throw ApiError.notFound("Review not found");
  }

  return review;
}

/**
 * Update a customer's own review.
 */
async function updateReview(user, reviewId, body) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true },
  });

  if (!review) {
    throw ApiError.notFound("Review not found");
  }

  if (review.userId !== user.id) {
    throw ApiError.forbidden("You can only edit your own reviews");
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      ...(body.rating !== undefined && { rating: body.rating }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.body !== undefined && { body: body.body }),
    },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  return updated;
}

/**
 * Delete a customer's own review (or admin can delete any).
 */
async function deleteReview(user, reviewId) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true },
  });

  if (!review) {
    throw ApiError.notFound("Review not found");
  }

  if (user.role !== "ADMIN" && review.userId !== user.id) {
    throw ApiError.forbidden("You can only delete your own reviews");
  }

  await prisma.review.delete({ where: { id: reviewId } });
}

/**
 * Admin: toggle a review's visibility.
 */
async function toggleReviewVisibility(reviewId) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, isVisible: true },
  });

  if (!review) {
    throw ApiError.notFound("Review not found");
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { isVisible: !review.isVisible },
  });

  return updated;
}

/**
 * List the authenticated customer's own reviews.
 */
async function listMyReviews(user, page, limit) {
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        product: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.review.count({ where: { userId: user.id } }),
  ]);

  return {
    reviews,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  createReview,
  listProductReviews,
  getReview,
  updateReview,
  deleteReview,
  toggleReviewVisibility,
  listMyReviews,
};
