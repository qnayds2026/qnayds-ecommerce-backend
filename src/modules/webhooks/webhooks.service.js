const { prisma } = require("../../config/db");
const { handlers } = require("./razorpay.events");

/**
 * Idempotent processing:
 *  - The WebhookEvent row (unique eventId) is inserted FIRST inside the same DB transaction as the
 *    state change. A concurrent duplicate blocks on the unique index until the first commits,
 *    then fails with P2002 -> we answer "DUPLICATE" and do nothing.
 *  - If anything throws, the whole transaction (including the event row) rolls back, so Razorpay's
 *    retry is processed cleanly instead of being mistaken for a duplicate.
 */
async function processEvent({ eventId, event }) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const row = await tx.webhookEvent.create({
          data: {
            eventId,
            provider: "RAZORPAY",
            eventType: event.event,
            status: "PROCESSING",
            // Store payload for reconciliation. Razorpay payloads carry no card numbers/CVV.
            payload: event,
          },
        });

        const handler = handlers[event.event];
        const outcome = handler
          ? await handler(tx, { eventId, event })
          : "IGNORED_UNSUPPORTED_EVENT";

        await tx.webhookEvent.update({
          where: { id: row.id },
          data: { status: "PROCESSED", outcome, processedAt: new Date() },
        });
        return outcome;
      },
      { timeout: 10000 }
    );
  } catch (err) {
    if (err && err.code === "P2002") return "DUPLICATE";
    throw err;
  }
}

module.exports = { processEvent };