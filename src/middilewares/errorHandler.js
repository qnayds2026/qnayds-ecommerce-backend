const ApiError = require("../utils/ApiError");

const errorHandler = (err, req, res, next) => {
  // Prisma known errors
  if (err.code === "P2002") {
    const fields = err.meta?.target || "field";
    err = new ApiError(409, `Duplicate value for ${fields}`);
  } else if (err.code === "P2025") {
    err = new ApiError(404, "Record not found");
  }

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details && { errors: err.details }),
    });
  }

  // Ariyaatha error: stack trace/internal details client-inu kodukkaruthu
  console.error(err);
  res.status(500).json({ success: false, message: "Internal server error" });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
};

module.exports = { errorHandler, notFoundHandler };