require("dotenv").config();

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
const {
  errorHandler,
  notFoundHandler,
} = require("./src/middilewares/errorHandler");

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(helmet());
app.use(
  cors({
    origin: authConfig.cors.allowedOrigins,
    credentials: true, // needed so the browser sends the refresh cookie
  })
);

// Test route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend server is running smoothly!",
  });
});

// Auth routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", usersRoutes);

// Product & inventory routes
app.use("/api/v1/sellers", sellerRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1", variantRoutes);
app.use("/api/v1", imageRoutes);
app.use("/api/v1", inventoryRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/addresses", addressRoutes);
// Must be after all routes
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