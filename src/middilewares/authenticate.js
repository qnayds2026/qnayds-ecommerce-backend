// Verifies the access JWT and attaches the current user to req.user.
// The user is loaded fresh from the database, so a changed role, or a
// deleted account, takes effect immediately instead of when the token expires.

// NOTE: adjust this import to match how src/config/db.js exports Prisma.
const { prisma } = require("../config/db");
const { verifyAccessToken } = require("../services/token.service");

const unauthorized = (res) =>
  res.status(401).json({ message: "Authentication required" });

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) return unauthorized(res);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (e) {
      // Invalid signature or expired token
      return unauthorized(res);
    }

    // passwordHash is never selected.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) return unauthorized(res);

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = authenticate;