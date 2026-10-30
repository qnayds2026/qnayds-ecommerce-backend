require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { connectDatabase } = require("./src/config/db");
const authConfig = require("./src/config/auth");
const authRoutes = require("./src/routes/auth.routes")
const usersRoutes = require("./src/routes/users.routes");

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

// Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", usersRoutes);

// Error handler (must be after all routes)
app.use((err, req, res, next) => {
  console.error(err.message); // message only, no stack or secrets
  res.status(500).json({ message: "Internal server error" });
});

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

module.exports = app;

if (require.main === module) {
  startServer();
}
