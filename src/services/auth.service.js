const bcrypt = require("bcryptjs");
// NOTE: adjust this import to match how src/config/db.js exports Prisma.
const { prisma } = require("../config/db");
const authConfig = require("../config/auth");
const tokenService = require("./token.service");

const httpError = (message, status) => {
  const err = new Error(message);
  err.statusCode = status;
  return err;
};

// passwordHash is never included in this.
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

// Used when the email does not exist, so login takes about the same time
// whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", authConfig.bcryptRounds);

const register = async ({ name, email, password }) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw httpError("Email is already registered", 409);

  const passwordHash = await bcrypt.hash(password, authConfig.bcryptRounds);

  try {
    // Role is always CUSTOMER. Seller onboarding is a separate flow.
    return await prisma.user.create({
      data: { name, email, passwordHash, role: "CUSTOMER" },
      select: safeUserSelect,
    });
  } catch (err) {
    // Two requests with the same email at the same time
    if (err.code === "P2002") throw httpError("Email is already registered", 409);
    throw err;
  }
};

const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  const passwordOk = await bcrypt.compare(
    password,
    user ? user.passwordHash : DUMMY_HASH
  );

  // Same generic message for unknown email and wrong password.
  if (!user || !passwordOk) throw httpError("Invalid email or password", 401);

  const accessToken = tokenService.generateAccessToken(user);
  const refresh = await tokenService.issueRefreshToken(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
};

const refresh = async (rawRefreshToken) => {
  // Validates, revokes the old token and issues a new one (rotation).
  const rotated = await tokenService.rotateRefreshToken(rawRefreshToken);

  const user = await prisma.user.findUnique({
    where: { id: rotated.userId },
    select: { id: true },
  });
  if (!user) throw httpError("Invalid or expired token", 401);

  return {
    accessToken: tokenService.generateAccessToken(user),
    refreshToken: rotated.token,
    refreshExpiresAt: rotated.expiresAt,
  };
};

const logout = async (rawRefreshToken) => {
  await tokenService.revokeRefreshToken(rawRefreshToken);
};

module.exports = { register, login, refresh, logout };