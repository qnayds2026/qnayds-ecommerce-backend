// LOCAL ONLY: runs the app with an in-memory fake database.
// Do NOT commit this file.
require("./tests/setup-env");
process.env.NODE_ENV = "development";

const { createFakePrisma } = require("./tests/helpers/fakePrisma");

// Replace the real db module with the fake one before the app loads it.
const dbPath = require.resolve("./src/config/db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { prisma: createFakePrisma(), connectDatabase: async () => {} },
};

const app = require("./server");
const PORT = 5001;
app.listen(PORT, () => console.log(`FAKE-DB server at http://localhost:${PORT}`));