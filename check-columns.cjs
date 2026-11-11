require("dotenv").config();

const { prisma } = require("./src/config/db");

async function main() {
  const roles = await prisma.$queryRaw`
    SELECT role, COUNT(*)::int AS count
    FROM users
    GROUP BY role
    ORDER BY role
  `;

  console.log("EXISTING USER ROLES:");
  console.log(roles);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
