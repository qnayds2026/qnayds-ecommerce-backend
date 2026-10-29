require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { connectDatabase } = require("./src/config/db");

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet());
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend server is running smoothly!",
  });
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

startServer();
