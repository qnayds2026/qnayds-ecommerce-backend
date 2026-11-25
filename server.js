require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { connectDatabase } = require("./src/config/db");
const authConfig = require("./src/config/auth");

// Routes
const authRoutes = require("./src/routes/auth.routes");
const usersRoutes = require("./src/routes/users.routes");
const sellerRoutes = require("./src/routes/seller.routes");
const categoryRoutes = require("./src/routes/category.routes");
const productRoutes = require("./src/routes/product.routes");
const variantRoutes = require("./src/routes/variant.routes");
const imageRoutes = require("./src/routes/image.routes");
const inventoryRoutes = require("./src/routes/inventory.routes");
const cartRoutes = require("./src/routes/cart.routes");
const wishlistRoutes = require("./src/routes/wishlist.routes");
const addressRoutes = require("./src/routes/addresses.routes");

const ordersRoutes = require("./src/modules/orders/orders.routes");
const adminRoutes = require("./src/modules/admin/admin.routes");
const webhookRoutes = require("./src/modules/webhooks/webhooks.routes");
const checkoutRoutes = require("./src/modules/checkout/checkout.routes");
const returnsRoutes = require("./src/modules/returns/returns.routes");
const sellerReturnsRoutes = require("./src/modules/returns/returns.seller.routes");
const adminReturnsRoutes = require("./src/modules/returns/returns.admin.routes");
const paymentRoutes = require("./src/modules/payments/payments.routes");
const notificationRoutes = require("./src/modules/notifications/notifications.routes");
const shippingRoutes = require("./src/modules/shipping/shipping.routes");
const reviewRoutes = require("./src/modules/reviews/reviews.routes");

const {
  startReturnEscalationJob,
} = require("./src/jobs/return-escalation.job");

const {
  errorHandler,
  notFoundHandler,
} = require("./src/middilewares/errorHandler");

const app = express();

// Trust Railway's reverse proxy
app.set("trust proxy", 1);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: authConfig.cors.allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],  
  }),
);

// Razorpay webhook must be mounted before express.json()
// Ensure the webhook router uses express.raw() for its webhook endpoint.
app.use("/api/v1/webhooks", webhookRoutes);

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Health check route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "QNAYDS E-commerce Backend is running!",
    environment: process.env.NODE_ENV || "development",
  });
});

// API routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/checkout", checkoutRoutes);
app.use("/api/v1/returns", returnsRoutes);
app.use("/api/v1/seller/returns", sellerReturnsRoutes);
app.use("/api/v1/admin/returns", adminReturnsRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/sellers", sellerRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1", variantRoutes);
app.use("/api/v1", imageRoutes);
app.use("/api/v1", inventoryRoutes);
app.use("/api/v1", ordersRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/addresses", addressRoutes);
app.use("/api/v1", shippingRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1", reviewRoutes);

// Error handlers (must remain last)
app.use(notFoundHandler);
app.use(errorHandler);

// Railway dynamically assigns PORT
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Connect database before accepting requests
    await connectDatabase();

    console.log("PostgreSQL connected successfully!");

    // Start background jobs
    startReturnEscalationJob();

    // Start HTTP server
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start only when executed directly
if (require.main === module) {
  startServer();
}

module.exports = app;
