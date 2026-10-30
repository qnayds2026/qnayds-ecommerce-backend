// Central auth configuration. All values come from environment variables.

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const isProduction = process.env.NODE_ENV === "production";

const authConfig = {
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  },
  refreshToken: {
    expiresDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || "30", 10),
    cookieName: process.env.REFRESH_COOKIE_NAME || "refresh_token",
  },
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : isProduction,
    sameSite: process.env.COOKIE_SAMESITE || "lax", // lax | strict | none
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: "/api/v1/auth", // cookie is sent only to auth endpoints
  },
  cors: {
    // Comma-separated list of allowed frontend origins
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || "12", 10),
};

module.exports = authConfig;