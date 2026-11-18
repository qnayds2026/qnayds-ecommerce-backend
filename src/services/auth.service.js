const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
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
  status: true,
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

const createSession = async (user) => {
  if (user.role === "CUSTOMER" && user.status === "BLOCKED") {
    throw httpError("Your account has been blocked", 403);
  }

  const accessToken = tokenService.generateAccessToken(user);
  const refresh = await tokenService.issueRefreshToken(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
};

const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  const passwordOk = await bcrypt.compare(
    password,
    user && user.passwordHash ? user.passwordHash : DUMMY_HASH
  );

  // Same generic message for unknown email and wrong password.
  if (!user || !user.passwordHash || !passwordOk) {
    throw httpError("Invalid email or password", 401);
  }

  return createSession(user);
};

const googleClient = new OAuth2Client();

const googleLogin = async ({ idToken }) => {
  if (!authConfig.google.clientId) {
    throw httpError("Google authentication is not configured", 503);
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: authConfig.google.clientId,
    });
    payload = ticket.getPayload();
  } catch (_error) {
    throw httpError("Invalid Google token", 401);
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw httpError("Google account email must be verified", 401);
  }

  const email = payload.email.trim().toLowerCase();
  const googleId = payload.sub;
  let user = await prisma.user.findUnique({ where: { googleId } });

  if (user) {
    if (user.email !== email) {
      throw httpError("Google account email does not match the linked account", 401);
    }
  } else {
    const existingEmailUser = await prisma.user.findUnique({ where: { email } });

    if (existingEmailUser) {
      if (existingEmailUser.googleId && existingEmailUser.googleId !== googleId) {
        throw httpError("This email is linked to another Google account", 409);
      }

      user = await prisma.user.update({
        where: { id: existingEmailUser.id },
        data: { googleId },
      });
    } else {
      try {
        user = await prisma.user.create({
          data: {
            name: payload.name || payload.given_name || email.split("@")[0],
            email,
            googleId,
            passwordHash: null,
            role: "CUSTOMER",
          },
        });
      } catch (error) {
        if (error.code !== "P2002") throw error;
        user = await prisma.user.findUnique({ where: { googleId } });
        if (!user) {
          const byEmail = await prisma.user.findUnique({ where: { email } });
          if (!byEmail) throw error;
          if (byEmail.googleId && byEmail.googleId !== googleId) {
            throw httpError("This email is linked to another Google account", 409);
          }
          user = byEmail.googleId
            ? byEmail
            : await prisma.user.update({
                where: { id: byEmail.id },
                data: { googleId },
              });
        }
      }
    }
  }

  if (!user) throw httpError("Unable to sign in with Google", 401);
  return createSession(user);
};

const refresh = async (rawRefreshToken) => {
  // Validates, revokes the old token and issues a new one (rotation).
  const rotated = await tokenService.rotateRefreshToken(rawRefreshToken);

  const user = await prisma.user.findUnique({
  where: { id: rotated.userId },
  select: { id: true, role: true, status: true },
});

if (!user) {
  await tokenService.revokeRefreshToken(rotated.token);
  throw httpError("Invalid or expired token", 401);
}

if (user.role === "CUSTOMER" && user.status === "BLOCKED") {
  await tokenService.revokeRefreshToken(rotated.token);
  throw httpError("Your account has been blocked", 403);
}

  return {
    accessToken: tokenService.generateAccessToken(user),
    refreshToken: rotated.token,
    refreshExpiresAt: rotated.expiresAt,
  };
};

const logout = async (rawRefreshToken) => {
  await tokenService.revokeRefreshToken(rawRefreshToken);
};

module.exports = { register, login, googleLogin, refresh, logout };