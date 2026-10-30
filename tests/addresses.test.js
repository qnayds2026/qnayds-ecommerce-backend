jest.mock("../src/config/db", () => {
  const m = {
    user: { findUnique: jest.fn() },
    address: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    $queryRaw: jest.fn(), // user-row lock used for default-address changes
  };
  m.$transaction = (fn) => fn(m);
  return { prisma: m, connectDatabase: jest.fn() };
});

const request = require("supertest");
const { prisma } = require("../src/config/db");
const app = require("../server");
const { cid, USER_A, USER_B, bearerFor, mockAuthenticatedUsers } = require("./helpers/mockAuth");

const ADDRESSES = "/api/v1/addresses";
const ADDRESS_ID = cid("addr1");
const auth = () => ({ Authorization: bearerFor(USER_A) });

const validBody = {
  recipientName: "Henna",
  phone: "9876543210",
  addressLine1: "12 MG Road",
  city: "Tirur",
  state: "Kerala",
  postalCode: "676101",
};

const stored = (over = {}) => ({ id: ADDRESS_ID, userId: USER_A, ...validBody, country: "India", isDefault: false, ...over });

beforeEach(() => {
  jest.resetAllMocks();
  mockAuthenticatedUsers(prisma);
  prisma.address.create.mockImplementation(async ({ data }) => ({ id: ADDRESS_ID, ...data }));
  prisma.address.update.mockImplementation(async ({ data }) => stored(data));
});

describe("authentication", () => {
  it.each([
    ["get", ADDRESSES],
    ["post", ADDRESSES],
    ["get", `${ADDRESSES}/${ADDRESS_ID}`],
    ["patch", `${ADDRESSES}/${ADDRESS_ID}`],
    ["delete", `${ADDRESSES}/${ADDRESS_ID}`],
  ])("%s %s without a token returns 401", async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
  });
});

describe("POST /addresses validation", () => {
  const create = (body) => request(app).post(ADDRESSES).set(auth()).send(body);

  it("rejects bad phone numbers", async () => {
    expect((await create({ ...validBody, phone: "12345" })).status).toBe(400);
    expect((await create({ ...validBody, phone: "abcdefghij" })).status).toBe(400);
  });

  it("rejects bad postal codes", async () => {
    expect((await create({ ...validBody, postalCode: "0123" })).status).toBe(400);
    expect((await create({ ...validBody, postalCode: "012345" })).status).toBe(400);
  });

  it("rejects missing required fields", async () => {
    const { city, ...rest } = validBody;
    expect((await create(rest)).status).toBe(400);
  });

  it("rejects unexpected fields such as userId", async () => {
    expect((await create({ ...validBody, userId: USER_B })).status).toBe(400);
    expect(prisma.address.create).not.toHaveBeenCalled();
  });
});

describe("POST /addresses default handling", () => {
  const create = (body) => request(app).post(ADDRESSES).set(auth()).send(body);

  it("makes the first address the default and owns it by the token's user", async () => {
    prisma.address.count.mockResolvedValue(0);
    const res = await create(validBody);
    expect(res.status).toBe(201);
    expect(prisma.address.create.mock.calls[0][0].data).toMatchObject({ userId: USER_A, isDefault: true });
  });

  it("unsets the previous default before creating a new default", async () => {
    prisma.address.count.mockResolvedValue(2);
    const res = await create({ ...validBody, isDefault: true });
    expect(res.status).toBe(201);
    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_A, isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.address.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.address.create.mock.invocationCallOrder[0]
    );
    expect(prisma.$queryRaw).toHaveBeenCalled(); // user row locked
  });

  it("leaves the existing default alone for a normal additional address", async () => {
    prisma.address.count.mockResolvedValue(1);
    await create(validBody);
    expect(prisma.address.updateMany).not.toHaveBeenCalled();
    expect(prisma.address.create.mock.calls[0][0].data.isDefault).toBe(false);
  });
});

describe("GET /addresses", () => {
  it("lists only the caller's addresses", async () => {
    prisma.address.findMany.mockResolvedValue([stored()]);
    const res = await request(app).get(ADDRESSES).set(auth());
    expect(res.status).toBe(200);
    expect(prisma.address.findMany.mock.calls[0][0].where).toEqual({ userId: USER_A });
  });

  it("404 for another customer's address", async () => {
    prisma.address.findFirst.mockResolvedValue(null);
    const res = await request(app).get(`${ADDRESSES}/${ADDRESS_ID}`).set(auth());
    expect(res.status).toBe(404);
    expect(prisma.address.findFirst.mock.calls[0][0].where).toEqual({ id: ADDRESS_ID, userId: USER_A });
  });

  it("rejects an invalid address id", async () => {
    expect((await request(app).get(`${ADDRESSES}/nope`).set(auth())).status).toBe(400);
  });
});

describe("PATCH /addresses/:addressId", () => {
  const patch = (body) => request(app).patch(`${ADDRESSES}/${ADDRESS_ID}`).set(auth()).send(body);

  it("404 for another customer's address and never updates it", async () => {
    prisma.address.findFirst.mockResolvedValue(null);
    const res = await patch({ city: "Kochi" });
    expect(res.status).toBe(404);
    expect(prisma.address.update).not.toHaveBeenCalled();
  });

  it("rejects an empty body and unknown fields", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ userId: USER_B })).status).toBe(400);
  });

  it("updates fields of an owned address", async () => {
    prisma.address.findFirst.mockResolvedValue(stored());
    const res = await patch({ city: "Kochi" });
    expect(res.status).toBe(200);
    expect(prisma.address.update).toHaveBeenCalledWith({ where: { id: ADDRESS_ID }, data: { city: "Kochi" } });
  });

  it("setting a new default unsets the other defaults only", async () => {
    prisma.address.findFirst.mockResolvedValue(stored());
    const res = await patch({ isDefault: true });
    expect(res.status).toBe(200);
    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_A, isDefault: true, NOT: { id: ADDRESS_ID } },
      data: { isDefault: false },
    });
  });

  it("refuses to unset the only default directly", async () => {
    prisma.address.findFirst.mockResolvedValue(stored({ isDefault: true }));
    const res = await patch({ isDefault: false });
    expect(res.status).toBe(400);
    expect(res.body.errors.code).toBe("DEFAULT_REQUIRED");
    expect(prisma.address.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /addresses/:addressId", () => {
  const del = () => request(app).delete(`${ADDRESSES}/${ADDRESS_ID}`).set(auth());

  it("404 for another customer's address and never deletes it", async () => {
    prisma.address.findFirst.mockResolvedValue(null);
    expect((await del()).status).toBe(404);
    expect(prisma.address.delete).not.toHaveBeenCalled();
  });

  it("deletes an owned, non-default address", async () => {
    prisma.address.findFirst.mockResolvedValue(stored());
    expect((await del()).status).toBe(204);
    expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: ADDRESS_ID } });
    expect(prisma.address.update).not.toHaveBeenCalled();
  });

  it("promotes another address when the default is deleted", async () => {
    const next = stored({ id: cid("addr2"), isDefault: false });
    prisma.address.findFirst
      .mockResolvedValueOnce(stored({ isDefault: true })) // the one being deleted
      .mockResolvedValueOnce(next); // replacement default
    expect((await del()).status).toBe(204);
    expect(prisma.address.update).toHaveBeenCalledWith({ where: { id: next.id }, data: { isDefault: true } });
  });
});