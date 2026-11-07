
const { z } = require("zod");
const { ORDER_STATUS_VALUES } = require("../orders/order-status");

const listCustomersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).optional(),
});

const dashboardQuery = z
  .object({
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (data) =>
      !data.startDate ||
      !data.endDate ||
      new Date(data.startDate) <= new Date(data.endDate),
    {
      message: "startDate must be before or equal to endDate",
      path: ["endDate"],
    }
  );

const listAdminProductsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["DRAFT", "ACTIVE", "REJECTED", "ARCHIVED"]).optional(),
  categoryId: z.string().min(1).optional(),
  sellerId: z.string().min(1).optional(),
  search: z.string().trim().max(100).optional(),
});

const updateProductStatusBody = z.object({
  status: z.enum(["ACTIVE", "REJECTED", "ARCHIVED", "DRAFT"]),
  reason: z.string().trim().max(500).optional(),
});

const updateCustomerStatusBody = z
  .object({
    status: z.enum(["ACTIVE", "BLOCKED"]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (data) => data.status !== "BLOCKED" || Boolean(data.reason),
    {
      message: "Reason is required to block a customer",
      path: ["reason"],
    }
  );

const listAdminOrdersQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    search: z.string().trim().max(100).optional(),
    status: z.enum(ORDER_STATUS_VALUES).optional(),
    customerId: z.string().trim().min(1).optional(),
    sellerId: z.string().trim().min(1).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.startDate <= data.endDate,
    {
      message: "startDate must be before or equal to endDate",
      path: ["endDate"],
    }
  );

const salesReportQuery = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.startDate <= data.endDate,
    {
      message: "startDate must be before or equal to endDate",
      path: ["endDate"],
    }
  );

module.exports = {
  dashboardQuery,
  listCustomersQuery,
  listAdminProductsQuery,
  updateProductStatusBody,
  listAdminOrdersQuery,
  updateCustomerStatusBody,
  salesReportQuery
};
