
const router = require("express").Router();

const authenticate = require("../../middilewares/authenticate");
const validate = require("../../middilewares/validateRequest");

const controller = require("./notifications.controller");
const validation = require("./notifications.validation");

// All notification routes require authentication.
router.use(authenticate);

// GET /api/v1/notifications
router.get(
  "/",
  validate({ query: validation.paginationQuery }),
  controller.listNotifications
);

// GET /api/v1/notifications/unread-count
router.get(
  "/unread-count",
  controller.getUnreadCount
);

// PATCH /api/v1/notifications/read-all
router.patch(
  "/read-all",
  controller.markAllNotificationsAsRead
);

// PATCH /api/v1/notifications/:notificationId/read
router.patch(
  "/:notificationId/read",
  validate({ params: validation.notificationIdParam }),
  controller.markNotificationAsRead
);

module.exports = router;
