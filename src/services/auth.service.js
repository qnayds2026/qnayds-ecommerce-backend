
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const { prisma } = require("../config/db");
const authConfig = require("../config/auth");
const tokenService = require("./token.service");

const googleClientId = authConfig.google?.clientId || "";
const googleClient = new OAuth2Client(googleClientId);

const httpError = (message, status) => {
  const err = new Error(message);
  err.statusCode = status;
  return err; 
};

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

const DUMMY_HASH = bcrypt.hashSync(
  "dummy-password",
  authConfig.bcryptRounds
);

const checkBlockedUser = (user) => {
  if (user.role === "CUSTOMER" && user.status === "BLOCKED") {
    throw httpError("Your account has been blocked", 403);
  }
};

const createAuthResponse = async (user) => {
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

const register = async ({ name, email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    throw httpError("Email is already registered", 409);
  }

  const passwordHash = await bcrypt.hash(
    password,
    authConfig.bcryptRounds
  );

  try {
    return await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        role: "CUSTOMER",
      },
      select: safeUserSelect,
    });
  } catch (err) {
    if (err.code === "P2002") {
      throw httpError("Email is already registered", 409);
    }
    throw err;
  }
};

const login = async ({ email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  const storedHash = user?.passwordHash;

  // Never pass a non-string hash to bcrypt.
  const usableHash =
    typeof storedHash === "string" && storedHash.length > 0
      ? storedHash
      : DUMMY_HASH;

  const passwordOk = await bcrypt.compare(
    typeof password === "string" ? password : "",
    usableHash
  );

  if (!user || !passwordOk || usableHash === DUMMY_HASH) {
    throw httpError("Invalid email or password", 401);
  }

  checkBlockedUser(user);

  return createAuthResponse(user);
};

const googleLogin = async ({ idToken }) => {
  if (!idToken || typeof idToken !== "string") {
    throw httpError("Google ID token is required", 400);
  }

  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: googleClientId || undefined,
    });

    payload = ticket.getPayload();
  } catch (err) {
    throw httpError("Invalid Google ID token", 401);
  }

  if (
    !payload ||
    !payload.sub ||
    !payload.email ||
    payload.email_verified !== true
  ) {
    throw httpError("Invalid or unverified Google account", 401);
  }

  const email = payload.email.trim().toLowerCase();

  let user = await prisma.user.findUnique({
    where: { googleId: payload.sub },
  });

  if (user) {
    if (user.email.toLowerCase() !== email) {
      throw httpError("Google account email does not match", 409);
    }
  } else {
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      if (
        existingUser.googleId &&
        existingUser.googleId !== payload.sub
      ) {
        throw httpError(
          "This email is already linked to another Google account",
          409
        );
      }

      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: { googleId: payload.sub },
      });
    } else {
      try {
        user = await prisma.user.create({
          data: {
            name: payload.name || null,
            email,
            googleId: payload.sub,
            passwordHash: null,
            role: "CUSTOMER",
          },
        });
      } catch (err) {
        if (err.code === "P2002") {
          throw httpError("Google account is already registered", 409);
        }
        throw err;
      }
    }
  }

  checkBlockedUser(user);

  return createAuthResponse(user);
};

const refresh = async (rawRefreshToken) => {
  const rotated = await tokenService.rotateRefreshToken(rawRefreshToken);

  const user = await prisma.user.findUnique({
    where: { id: rotated.userId },
    select: {
      id: true,
      role: true,
      status: true,
    },
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

module.exports = {
  register,
  login,
  googleLogin,
  refresh,
  logout,
};
