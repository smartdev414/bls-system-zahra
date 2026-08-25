import prisma from "@/lib/prisma"
import { NotificationType } from "@/app/generated/prisma/enums"
import { sendNotificationEmail } from "@/lib/email"

/**
 * Notifications are fire-and-forget: a failure here must never take down the
 * thing the user actually asked for. That is right, and it is also how a
 * co-teaching invite went undelivered for two months without anyone seeing an
 * error — the write failed, the catch logged it where nobody was looking, and
 * the teacher who sent it was told it had worked.
 *
 * So these still never throw, but they now say whether they delivered. A caller
 * that reports back to a person (the invite button) can await the answer and
 * tell the truth; a caller firing into the background can keep ignoring it.
 */

/** True when the notification row was written and the email was handed off. */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string,
): Promise<boolean> {
  try {
    await prisma.notification.create({ data: { userId, type, title, body, link: link ?? null } })
    // Fire email — never awaited so it never blocks the primary action
    void sendNotificationEmail(userId, type, title, body, link)
    return true
  } catch (err) {
    console.error(`[notifications] createNotification failed (type=${type}, user=${userId})`, err)
    return false
  }
}

/** True when the notification rows were written and the emails were handed off. */
export async function createNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  link?: string,
): Promise<boolean> {
  if (userIds.length === 0) return true
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
    return true
  } catch (err) {
    // Worth naming the type: the failure that hid the co-teaching invite was an
    // enum value missing from the database, and the type is what identifies it.
    console.error(
      `[notifications] createNotifications failed for ${userIds.length} recipient(s) ` +
      `(type=${type}) — nobody was notified and no email was sent`,
      err,
    )
    return false
  }
}
