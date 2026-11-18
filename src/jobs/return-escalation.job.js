
const cron = require("node-cron");
const { prisma } = require("../config/db");
const {
  createManyNotifications,
} = require("../modules/notifications/notifications.service");

const RETURN_ESCALATION_DAYS =
  Number(process.env.RETURN_ESCALATION_DAYS) || 3;

const DAY_MS = 24 * 60 * 60 * 1000;

let isRunning = false;

async function runReturnEscalationJob() {
  if (isRunning) return;

  isRunning = true;

  try {
    const cutoff = new Date(
      Date.now() - RETURN_ESCALATION_DAYS * DAY_MS
    );

    const pendingReturns = await prisma.returnRequest.findMany({
      where: {
        status: "REQUESTED",
        escalatedAt: null,
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        returnNumber: true,
      },
    });

    for (const candidate of pendingReturns) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const escalatedAt = new Date();

          const updated = await tx.returnRequest.updateMany({
            where: {
              id: candidate.id,
              status: "REQUESTED",
              escalatedAt: null,
              createdAt: { lte: cutoff },
            },
            data: {
              escalatedAt,
              escalationReason:
                "Automatically escalated because the seller did not respond within the response window.",
              escalationType: "AUTO",
            },
          });

          if (updated.count === 0) return false;

          await tx.returnStatusHistory.create({
            data: {
              returnId: candidate.id,
              oldStatus: "REQUESTED",
              newStatus: "REQUESTED",
              changedBy: "SYSTEM",
              actorRole: "SYSTEM",
              note: `Automatically escalated after ${RETURN_ESCALATION_DAYS} days without seller decision.`,
            },
          });

          return true;
        });

        if (!result) continue;

        try {
          const admins = await prisma.user.findMany({
            where: { role: "ADMIN" },
            select: { id: true },
          });

          await createManyNotifications(
            admins.map((admin) => ({
              userId: admin.id,
              type: "RETURN_ESCALATED",
              title: "Return Escalated for Admin Review",
              message: `Return ${candidate.returnNumber} has been automatically escalated for admin review.`,
              link: `/admin/returns/${candidate.id}`,
              dedupeKey: `RETURN_ESCALATED:${candidate.id}:${admin.id}`,
            }))
          );
        } catch (notificationError) {
          console.error(
            "Automatic return escalation notification failed:",
            notificationError.message
          );
        }

        console.log(
          `Return ${candidate.returnNumber} automatically escalated.`
        );
      } catch (returnError) {
        console.error(
          `Failed to escalate return ${candidate.id}:`,
          returnError.message
        );
      }
    }
  } catch (error) {
    console.error("Return escalation job failed:", error.message);
  } finally {
    isRunning = false;
  }
}

function startReturnEscalationJob() {
  cron.schedule("0 * * * *", runReturnEscalationJob);

  console.log(
    `Return escalation job scheduled. Response window: ${RETURN_ESCALATION_DAYS} days.`
  );
}

module.exports = {
  startReturnEscalationJob,
  runReturnEscalationJob,
};
