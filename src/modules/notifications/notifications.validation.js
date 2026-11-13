
const { z } = require("zod");

const notificationIdParam = z.object({
  notificationId: z.string().trim().min(1, "Notification ID is required"),
});

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

module.exports = {
  notificationIdParam,
  paginationQuery,
};
