
const { prisma } = require("../../config/db");
const {
  createManyNotifications,
} = require("../notifications/notifications.service");
const { handlers } = require("./razorpay.events");

/**
 * Idempotent webhook processing.
 * Business changes and webhook event record commit together.
 * Notifications are created after commit so notification failure
 * cannot roll back the business transaction.
 */
async function processEvent({ eventId, event }) {
  const notifications = [];

  let outcome;

  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        const row = await tx.webhookEvent.create({
          data: {
            eventId,
            provider: "RAZORPAY",
            eventType: event.event,
            status: "PROCESSING",
            payload: event,
          },
        });

        const handler = handlers[event.event];

        const result = handler
          ? await handler(tx, {
              eventId,
              event,
              notifications,
            })
          : "IGNORED_UNSUPPORTED_EVENT";

        await tx.webhookEvent.update({
          where: { id: row.id },
          data: {
            status: "PROCESSED",
            outcome: result,
            processedAt: new Date(),
          },
        });

        return result;
      },
      { timeout: 10000 }
    );
  } catch (err) {
    if (err && err.code === "P2002") {
      return "DUPLICATE";
    }

    throw err;
  }

  // Best-effort notification creation after the transaction commits.
  if (notifications.length > 0) {
    try {
      await createManyNotifications(notifications);
    } catch (error) {
      console.error(
        "Webhook notifications could not be created:",
        error.message
      );
    }
  }

  return outcome;
}

module.exports = { processEvent };
