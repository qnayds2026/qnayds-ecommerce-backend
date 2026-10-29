const authConfig = require("../config/auth");

// CSRF defense for cookie-based endpoints (login, refresh, logout).
// Browsers always send an Origin header on cross-site POST requests, so if
// Origin is present it must be one of the allowed frontend origins.
// Requests without Origin (Postman, curl, server-to-server) are allowed:
// they cannot be forged through a victim's browser cookie.
const verifyOrigin = (req, res, next) => {
  const origin = req.headers.origin;

  if (origin && !authConfig.cors.allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: "Origin not allowed" });
  }

  return next();
};

module.exports = verifyOrigin;