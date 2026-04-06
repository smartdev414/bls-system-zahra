import prisma from "@/lib/prisma"
import { NotificationType } from "@/app/generated/prisma/enums"
import { sendNotificationEmail } from "@/lib/email"

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string,
) {
  try {
    await prisma.notification.create({ data: { userId, type, title, body, link: link ?? null } })
    // Fire email — never awaited so it never blocks the primary action
    void sendNotificationEmail(userId, type, title, body, link)
  } catch (err) {
    // Notifications are fire-and-forget — never block the primary action
    console.error("[notifications] createNotification failed", err)
  }
}

export async function createNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  link?: string,
) {
  if (userIds.length === 0) return
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, type, title, body, link: link ?? null })),
    })
    // Send email to each recipient in parallel — capped to avoid overwhelming the queue
    const EMAIL_BATCH = 20
    for (let i = 0; i < userIds.length; i += EMAIL_BATCH) {
      void Promise.all(
        userIds.slice(i, i + EMAIL_BATCH).map((uid) =>
          sendNotificationEmail(uid, type, title, body, link),
        ),
      )
    }
  } catch (err) {
    console.error("[notifications] createNotifications failed", err)
  }
}
