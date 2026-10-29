const crypto = require("crypto");
const jwt = require("jsonwebtoken");
// NOTE: adjust this import to match how src/config/db.js exports Prisma
// (e.g. `module.exports = { prisma, connectDatabase }` or `module.exports = prisma`).
const { prisma } = require("../config/db");
const authConfig = require("../config/auth");

const authError = (message = "Invalid or expired token", status = 401) => {
  const err = new Error(message);
  err.statusCode = status;
  return err;
};

// ---------- Access token (JWT) ----------

// Claims are kept minimal: only the user id (sub). Role is NOT put in the
// token; authenticate middleware loads the fresh user from the database.
const generateAccessToken = (user) =>
  jwt.sign({ sub: user.id }, authConfig.jwt.accessSecret, {
    expiresIn: authConfig.jwt.accessExpiresIn,
  });

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, authConfig.jwt.accessSecret);
  } catch (e) {
    throw authError("Invalid or expired access token");
  }
};

// ---------- Refresh token (opaque, stored hashed) ----------

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const generateRawRefreshToken = () =>
  crypto.randomBytes(48).toString("base64url");

const refreshExpiryDate = () =>
  new Date(Date.now() + authConfig.refreshToken.expiresDays * 24 * 60 * 60 * 1000);

// Creates a new refresh token. A new login starts a new family.
// Only the hash is saved in the database; the raw token is returned once.
const issueRefreshToken = async (userId, familyId = crypto.randomUUID(), db = prisma) => {
  const raw = generateRawRefreshToken();
  const expiresAt = refreshExpiryDate();

  const record = await db.refreshToken.create({
    data: { tokenHash: hashToken(raw), userId, familyId, expiresAt },
  });

  return { token: raw, expiresAt, id: record.id, familyId };
};

const revokeFamily = (familyId, db = prisma) =>
  db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

// Validates the presented refresh token, revokes it and issues a replacement
// in the same family. A reused (already revoked) token revokes the whole family.
const rotateRefreshToken = async (rawToken) => {
  if (!rawToken) throw authError("Refresh token missing");

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  if (!existing) throw authError("Invalid refresh token");

  // Reuse detection: a revoked token is being presented again.
  if (existing.revokedAt) {
    await revokeFamily(existing.familyId);
    throw authError("Refresh token reuse detected");
  }

  if (existing.expiresAt <= new Date()) {
    throw authError("Refresh token expired");
  }

  return prisma.$transaction(async (tx) => {
    // Atomic claim: only one concurrent request can revoke this token.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (claimed.count === 0) {
      await revokeFamily(existing.familyId, tx);
      throw authError("Refresh token reuse detected");
    }

    const next = await issueRefreshToken(existing.userId, existing.familyId, tx);

    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { replacedById: next.id },
    });

    return { userId: existing.userId, token: next.token, expiresAt: next.expiresAt };
  });
};

// Logout: revokes the presented token's whole family. Silent if unknown,
// so logout never leaks whether a token was valid.
const revokeRefreshToken = async (rawToken) => {
  if (!rawToken) return;

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  if (existing) await revokeFamily(existing.familyId);
};

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
};