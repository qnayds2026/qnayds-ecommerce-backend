jest.mock("../src/config/db", () => {
  const { createFakePrisma } = require("./helpers/fakePrisma");
  return { prisma: createFakePrisma(), connectDatabase: jest.fn() };
});

let mockPayload;
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(async () => ({
      getPayload: () => mockPayload,
    })),
  })),
}));

const request = require("supertest");
const app = require("../server");
const { prisma } = require("../src/config/db");

const endpoint = "/api/v1/auth/google";
const postGoogle = (idToken = "valid-google-id-token") =>
  request(app).post(endpoint).set("Origin", "http://localhost:3000").send({ idToken });

beforeEach(() => {
  prisma._reset();
  mockPayload = {
    sub: "google-subject-123",
    email: "google.user@example.com",
    email_verified: true,
    name: "Google User",
  };
});

describe("POST /api/v1/auth/google", () => {
  it("creates a CUSTOMER account for a new verified Google user and issues JWT + refresh cookie", async () => {
    const res = await postGoogle();

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "google.user@example.com",
      name: "Google User",
      role: "CUSTOMER",
      status: "ACTIVE",
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(prisma._users).toHaveLength(1);
    expect(prisma._users[0].googleId).toBe("google-subject-123");
    expect(prisma._users[0].passwordHash).toBeNull();
    expect(res.headers["set-cookie"].join(";")).toMatch(/HttpOnly/i);
  });

  it("links a verified Google identity to an existing email account without creating a duplicate", async () => {
    await request(app).post("/api/v1/auth/register").send({
      name: "Existing User",
      email: "google.user@example.com",
      password: "Secret123",
    });

    const res = await postGoogle();

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(prisma._users[0].id);
    expect(prisma._users).toHaveLength(1);
    expect(prisma._users[0].googleId).toBe("google-subject-123");
    expect(prisma._users[0].passwordHash).toMatch(/^\$2/);
  });

  it("rejects unverified Google email", async () => {
    mockPayload.email_verified = false;
    const res = await postGoogle();
    expect(res.status).toBe(401);
    expect(prisma._users).toHaveLength(0);
  });

  it("rejects a Google identity already linked to a different account email", async () => {
    await request(app).post("/api/v1/auth/register").send({
      name: "Existing User",
      email: "google.user@example.com",
      password: "Secret123",
    });
    await prisma.user.update({
      where: { id: prisma._users[0].id },
      data: { googleId: "different-google-subject" },
    });

    const res = await postGoogle();
    expect(res.status).toBe(409);
    expect(prisma._users).toHaveLength(1);
  });

  it("does not sign in a blocked customer", async () => {
    mockPayload.email = "blocked@example.com";
    await request(app).post("/api/v1/auth/register").send({
      name: "Blocked",
      email: "blocked@example.com",
      password: "Secret123",
    });
    await prisma.user.update({
      where: { id: prisma._users[0].id },
      data: { status: "BLOCKED" },
    });

    const res = await postGoogle();
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Your account has been blocked");
  });

  it("validates that an ID token is supplied", async () => {
    const res = await request(app)
      .post(endpoint)
      .set("Origin", "http://localhost:3000")
      .send({});
    expect(res.status).toBe(400);
  });
});
