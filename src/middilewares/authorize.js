// Role check. Must run AFTER authenticate.
//
// Usage: router.get("/admin-only", authenticate, authorize("ADMIN"), handler);
//        router.post("/x", authenticate, authorize("SELLER", "ADMIN"), handler);
//
// This only checks the role. For resources owned by a user (for example a
// seller's product), the service must still check that the seller owns it.

const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "You do not have permission to perform this action" });
  }

  return next();
};

module.exports = authorize;