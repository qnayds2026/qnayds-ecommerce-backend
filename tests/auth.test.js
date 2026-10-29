jest.mock("../src/config/db", () => {
  const { createFakePrisma } = require("./helpers/fakePrisma");
  return { prisma: createFakePrisma(), connectDatabase: jest.fn() };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { prisma } = require("../src/config/db");
const app = require("../server");
const authorize = require("../src/middilewares/authorize");

const AUTH = "/api/v1/auth";
const USERS = "/api/v1/users";
const validUser = { name: "Henna", email: "henna@example.com", password: "Secret123" };

const register = (body = validUser) => request(app).post(`${AUTH}/register`).send(body);

const login = (body = { email: validUser.email, password: validUser.password }) =>
  request(app).post(`${AUTH}/login`).send(body);

const registerAndLogin = async () => {
  await register();
  return login();
};

// "refresh_token=abc; Path=/api/v1/auth; HttpOnly" -> "refresh_token=abc"
// A cleared cookie comes back as "refresh_token=".
const getRefreshCookie = (res) => {
  const cookies = res.headers["set-cookie"] || [];
  const found = cookies.find((c) => c.startsWith("refresh_token="));
  return found ? found.split(";")[0] : null;
};

const refresh = (cookie) => {
  const req = request(app).post(`${AUTH}/refresh`);
  return cookie ? req.set("Cookie", cookie) : req;
};

const bearer = (token) => `Bearer ${token}`;

beforeEach(() => {
  prisma._reset();
});

describe("POST /auth/register", () => {
  it("creates a CUSTOMER and never returns passwordHash", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: "henna@example.com",
      name: "Henna",
      role: "CUSTOMER",
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("stores a bcrypt hash, not the plaintext password", async () => {
    await register();
    const stored = prisma._users[0].passwordHash;
    expect(stored).not.toBe(validUser.password);
    expect(stored.startsWith("$2")).toBe(true);
  });

  it("ignores a role sent by the client", async () => {
    const res = await register({ ...validUser, role: "ADMIN" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("CUSTOMER");
    expect(prisma._users[0].role).toBe("CUSTOMER");
  });

  it("normalizes the email", async () => {
    const res = await register({ ...validUser, email: "  HENNA@Example.com " });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("henna@example.com");
  });

  it("returns 409 for a duplicate email", async () => {
    await register();
    const res = await register();
    expect(res.status).toBe(409);
  });

  it("returns 400 with errors for invalid input", async () => {
    const res = await register({ email: "bad", password: "123" });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});

describe("POST /auth/login", () => {
  it("returns an access token and sets an HttpOnly refresh cookie", async () => {
    await register();
    const res = await login();

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(validUser.email);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined(); // cookie only

    const setCookie = res.headers["set-cookie"].join(";");
    expect(setCookie).toMatch(/refresh_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it("stores only a hash of the refresh token", async () => {
    const res = await registerAndLogin();
    const raw = getRefreshCookie(res).split("=")[1];

    expect(prisma._tokens).toHaveLength(1);
    expect(prisma._tokens[0].tokenHash).not.toBe(raw);
    expect(prisma._tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("issues a short-lived access token with minimal claims", async () => {
    const res = await registerAndLogin();
    const decoded = jwt.decode(res.body.accessToken);

    expect(decoded.exp - decoded.iat).toBe(15 * 60);
    expect(decoded.sub).toBe(res.body.user.id);
    expect(decoded.role).toBeUndefined();
    expect(decoded.email).toBeUndefined();
  });

  it("gives the same generic 401 for wrong password and unknown email", async () => {
    await register();
    const wrong = await login({ email: validUser.email, password: "Wrong1234" });
    const unknown = await login({ email: "nobody@example.com", password: "Secret123" });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("returns 400 when fields are missing", async () => {
    const res = await login({});
    expect(res.status).toBe(400);
  });

  it("rejects a request from a disallowed origin (CSRF check)", async () => {
    await register();
    const res = await request(app)
      .post(`${AUTH}/login`)
      .set("Origin", "http://evil.example")
      .send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(403);
  });

  it("accepts a request from an allowed origin", async () => {
    await register();
    const res = await request(app)
      .post(`${AUTH}/login`)
      .set("Origin", "http://localhost:3000")
      .send({ email: validUser.email, password: validUser.password });
    expect(res.status).toBe(200);
  });
});

describe("POST /auth/refresh", () => {
  it("rotates the refresh token and revokes the old one", async () => {
    const loginRes = await registerAndLogin();
    const oldCookie = getRefreshCookie(loginRes);

    const res = await refresh(oldCookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));

    const newCookie = getRefreshCookie(res);
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(oldCookie);

    expect(prisma._tokens).toHaveLength(2);
    const [oldRecord, newRecord] = prisma._tokens;
    expect(oldRecord.revokedAt).toBeInstanceOf(Date);
    expect(oldRecord.replacedById).toBe(newRecord.id);
    expect(newRecord.revokedAt).toBeNull();
    expect(newRecord.familyId).toBe(oldRecord.familyId);
  });

  it("returns an access token that works on /auth/me", async () => {
    const loginRes = await registerAndLogin();
    const res = await refresh(getRefreshCookie(loginRes));

    const me = await request(app)
      .get(`${AUTH}/me`)
      .set("Authorization", bearer(res.body.accessToken));
    expect(me.status).toBe(200);
  });

  it("detects reuse of an old token and revokes the whole family", async () => {
    const loginRes = await registerAndLogin();
    const oldCookie = getRefreshCookie(loginRes);

    const first = await refresh(oldCookie);
    const newCookie = getRefreshCookie(first);

    const reuse = await refresh(oldCookie); // old token again
    expect(reuse.status).toBe(401);
    expect(getRefreshCookie(reuse)).toBe("refresh_token="); // cookie cleared

    const afterReuse = await refresh(newCookie); // newest token is dead too
    expect(afterReuse.status).toBe(401);
    expect(prisma._tokens.every((t) => t.revokedAt)).toBe(true);
  });

  it("returns 401 when the cookie is missing", async () => {
    const res = await refresh(null);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown token", async () => {
    const res = await refresh("refresh_token=not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired refresh token", async () => {
    const loginRes = await registerAndLogin();
    prisma._tokens[0].expiresAt = new Date(Date.now() - 1000);

    const res = await refresh(getRefreshCookie(loginRes));
    expect(res.status).toBe(401);
  });

  it("rejects a request from a disallowed origin", async () => {
    const loginRes = await registerAndLogin();
    const res = await request(app)
      .post(`${AUTH}/refresh`)
      .set("Origin", "http://evil.example")
      .set("Cookie", getRefreshCookie(loginRes));
    expect(res.status).toBe(403);
  });
});

describe("POST /auth/logout", () => {
  it("revokes the refresh token and clears the cookie", async () => {
    const loginRes = await registerAndLogin();
    const cookie = getRefreshCookie(loginRes);

    const res = await request(app).post(`${AUTH}/logout`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(getRefreshCookie(res)).toBe("refresh_token=");
    expect(prisma._tokens.every((t) => t.revokedAt)).toBe(true);

    const after = await refresh(cookie);
    expect(after.status).toBe(401);
  });

  it("succeeds even without a cookie", async () => {
    const res = await request(app).post(`${AUTH}/logout`);
    expect(res.status).toBe(200);
  });
});

describe("GET /auth/me", () => {
  it("returns the safe profile for a valid token", async () => {
    const loginRes = await registerAndLogin();
    const res = await request(app)
      .get(`${AUTH}/me`)
      .set("Authorization", bearer(loginRes.body.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(validUser.email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get(`${AUTH}/me`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed token", async () => {
    const res = await request(app)
      .get(`${AUTH}/me`)
      .set("Authorization", bearer("garbage"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for the wrong auth scheme", async () => {
    const loginRes = await registerAndLogin();
    const res = await request(app)
      .get(`${AUTH}/me`)
      .set("Authorization", `Basic ${loginRes.body.accessToken}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired access token", async () => {
    const loginRes = await registerAndLogin();
    const expired = jwt.sign({ sub: loginRes.body.user.id }, process.env.JWT_ACCESS_SECRET, {
      expiresIn: -10,
    });

    const res = await request(app).get(`${AUTH}/me`).set("Authorization", bearer(expired));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token signed with a different secret", async () => {
    const loginRes = await registerAndLogin();
    const forged = jwt.sign({ sub: loginRes.body.user.id }, "some-other-secret");

    const res = await request(app).get(`${AUTH}/me`).set("Authorization", bearer(forged));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the user no longer exists", async () => {
    const loginRes = await registerAndLogin();
    prisma._reset();

    const res = await request(app)
      .get(`${AUTH}/me`)
      .set("Authorization", bearer(loginRes.body.accessToken));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /users/me", () => {
  it("updates the name", async () => {
    const loginRes = await registerAndLogin();
    const res = await request(app)
      .patch(`${USERS}/me`)
      .set("Authorization", bearer(loginRes.body.accessToken))
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("New Name");
  });

  it("rejects role changes with 400 and leaves the role unchanged", async () => {
    const loginRes = await registerAndLogin();
    const res = await request(app)
      .patch(`${USERS}/me`)
      .set("Authorization", bearer(loginRes.body.accessToken))
      .send({ role: "ADMIN" });

    expect(res.status).toBe(400);
    expect(prisma._users[0].role).toBe("CUSTOMER");
  });

  it("rejects an empty body", async () => {
    const loginRes = await registerAndLogin();
    const res = await request(app)
      .patch(`${USERS}/me`)
      .set("Authorization", bearer(loginRes.body.accessToken))
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).patch(`${USERS}/me`).send({ name: "x" });
    expect(res.status).toBe(401);
  });
});

describe("authorize middleware", () => {
  const run = (user, ...roles) => {
    const req = { user };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();
    authorize(...roles)(req, res, next);
    return { res, next };
  };

  it("returns 401 when there is no authenticated user", () => {
    const { res, next } = run(undefined, "ADMIN");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the role is not allowed", () => {
    const { res, next } = run({ role: "CUSTOMER" }, "ADMIN");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when the role is allowed", () => {
    const { res, next } = run({ role: "SELLER" }, "SELLER", "ADMIN");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});