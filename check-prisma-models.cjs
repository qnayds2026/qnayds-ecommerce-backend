const { prisma } = require("./src/config/db");

console.log("wishlistItem:", typeof prisma.wishlistItem);
console.log("cartItem:", typeof prisma.cartItem);

prisma.$disconnect();
