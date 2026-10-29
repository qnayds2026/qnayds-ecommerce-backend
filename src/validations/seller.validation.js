const { z } = require("zod");

// ID type (uuid / cuid / int) schema.prisma nokki maattuka
const idParam = z.object({ id: z.string().min(1) });

const createSellerBody = z.object({
  shopName: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
});

const updateStatusBody = z.object({
  status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]),
});

module.exports = { idParam, createSellerBody, updateStatusBody };