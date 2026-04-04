import prisma from "@/lib/prisma"
import { NotificationType } from "@/app/generated/prisma/enums"

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string,
) {
  try {
    await prisma.notification.create({ data: { userId, type, title, body, link: link ?? null } })
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
  } catch (err) {
    console.error("[notifications] createNotifications failed", err)
  }
}
