require("dotenv").config();

const bcrypt = require("bcryptjs");
const { prisma } = require("./src/config/db");
const authConfig = require("./src/config/auth");

async function main() {
  const email = "admin.test@example.com";
  const password = "AdminTest@123";

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.log("Dummy Admin already exists:", existing.email);
    return;
  }

  const passwordHash = await bcrypt.hash(
    password,
    authConfig.bcryptRounds
  );

  const admin = await prisma.user.create({
    data: {
      name: "Test Admin",
      email,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  });

  console.log("DUMMY ADMIN CREATED:");
  console.log(admin);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
