
const asyncHandler = require("../../utils/asyncHandler");
const { prisma } = require("../../config/db");

const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, unreadOnly } = req.validated.query;

  const skip = (page - 1) * limit;

  const where = {
    userId: req.user.id,
    ...(unreadOnly ? { isRead: false } : {}),
  };

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await prisma.notification.count({
    where: {
      userId: req.user.id,
      isRead: false,
    },
  });

  res.json({
    success: true,
    data: { unreadCount: count },
  });
});

const markNotificationAsRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.validated.params;

  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId: req.user.id,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });

  if (result.count === 0) {
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId: req.user.id,
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }
  }

  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId: req.user.id,
    },
  });

  res.json({
    success: true,
    message: "Notification marked as read",
    data: notification,
  });
});

const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: {
      userId: req.user.id,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });

  res.json({
    success: true,
    message: "All notifications marked as read",
    data: {
      updatedCount: result.count,
    },
  });
});

module.exports = {
  listNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
