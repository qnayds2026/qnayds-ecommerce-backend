
const { prisma } = require("../../config/db");

/**
 * Create a notification for a specific user.
 * Accepts an optional Prisma transaction client.
 * Duplicate notifications are ignored using dedupeKey.
 */
const createNotification = async ({
  userId,
  type,
  title,
  message,
  link = null,
  dedupeKey,
  tx = null,
}) => {
  try {
    if (!userId || !type || !title || !message || !dedupeKey) {
      console.error("Notification skipped: Required fields are missing");
      return null;
    }

    const db = tx || prisma;

    const notification = await db.notification.upsert({
      where: { dedupeKey },
      create: {
        userId,
        type,
        title,
        message,
        link,
        dedupeKey,
      },
      update: {},
    });

    return notification;
  } catch (error) {
    console.error("Notification creation failed:", error.message);
    return null;
  }
};

/**
 * Create notifications for multiple users.
 */
const createManyNotifications = async (notifications = [], tx = null) => {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return [];
  }

  const results = await Promise.all(
    notifications.map((notification) =>
      createNotification({ ...notification, tx })
    )
  );

  return results.filter(Boolean);
};

module.exports = {
  createNotification,
  createManyNotifications,
};
