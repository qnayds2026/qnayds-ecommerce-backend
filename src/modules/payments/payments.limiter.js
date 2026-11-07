const rateLimit = require("express-rate-limit");

// Applied to the sensitive checkout/payment endpoints (keyed by client IP).
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});

module.exports = { sensitiveLimiter };