
const { z } = require("zod");

const idParam = z.object({
  id: z.string().min(1),
});

const createSellerBody = z.object({
  shopName: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
});

const updateStatusBody = z
  .object({
    status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "REJECTED" && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reason is required when rejecting a seller",
        path: ["reason"],
      });
    }
  });

const listSellerQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
  search: z.string().trim().max(100).optional(),
});

// Backward-compatible status-only query
const listSellersQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
});

module.exports = {
  idParam,
  createSellerBody,
  updateStatusBody,
  listSellerQuery,
  listSellersQuery,
};
