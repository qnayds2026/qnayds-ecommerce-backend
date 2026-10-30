const crypto = require("crypto");

const createFakePrisma = () => {
  let users = [];
  let tokens = [];

  const pick = (row, select) => {
    if (!row) return null;
    if (!select) return { ...row };
    const out = {};
    for (const key of Object.keys(select)) {
      if (select[key]) out[key] = row[key];
    }
    return out;
  };

  const matches = (row, where) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const fake = {
    user: {
      findUnique: async ({ where, select }) =>
        pick(users.find((u) => matches(u, where)), select),

      create: async ({ data, select }) => {
        if (users.some((u) => u.email === data.email)) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const now = new Date();
        const row = {
          id: crypto.randomUUID(),
          name: null,
          role: "CUSTOMER",
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        users.push(row);
        return pick(row, select);
      },

      update: async ({ where, data, select }) => {
        const row = users.find((u) => matches(u, where));
        if (!row) throw new Error("Record not found");
        Object.assign(row, data, { updatedAt: new Date() });
        return pick(row, select);
      },
    },

    refreshToken: {
      create: async ({ data }) => {
        const row = {
          id: crypto.randomUUID(),
          revokedAt: null,
          replacedById: null,
          createdAt: new Date(),
          ...data,
        };
        tokens.push(row);
        return { ...row };
      },

      findUnique: async ({ where }) => {
        const row = tokens.find((t) => matches(t, where));
        return row ? { ...row } : null;
      },

      updateMany: async ({ where, data }) => {
        const rows = tokens.filter((t) => matches(t, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },

      update: async ({ where, data }) => {
        const row = tokens.find((t) => matches(t, where));
        if (!row) throw new Error("Record not found");
        Object.assign(row, data);
        return { ...row };
      },
    },

    $transaction: async (fn) => fn(fake),

    // test helpers
    _reset: () => {
      users = [];
      tokens = [];
    },
    get _users() {
      return users;
    },
    get _tokens() {
      return tokens;
    },
  };

  return fake;
};

module.exports = { createFakePrisma };