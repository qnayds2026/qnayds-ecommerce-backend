require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { connectDatabase } = require("./src/config/db");
const authConfig = require("./src/config/auth");

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

const {
  errorHandler,
  notFoundHandler,
} = require("./src/middilewares/errorHandler");

const app = express();


// Razorpay webhook: MUST be mounted before express.json()/urlencoded so the raw body is preserved
app.use("/api/v1/webhooks", webhookRoutes);


// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(helmet());

app.use(
  cors({
    origin: authConfig.cors.allowedOrigins,
    credentials: true,
  })
);

// Test route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend server is running smoothly!",
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

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
