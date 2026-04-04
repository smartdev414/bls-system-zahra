import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

// GET /api/notifications — fetch the current user's notifications (latest 50)
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const notifications = await prisma.notification.findMany({
      where: { userId: session.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    const unreadCount = await prisma.notification.count({
      where: { userId: session.sub, isRead: false },
    })

    return NextResponse.json({ notifications, unreadCount })
  } catch (err) {
    console.error("[GET /api/notifications]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/notifications — mark all as read
export async function PATCH() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    await prisma.notification.updateMany({
      where: { userId: session.sub, isRead: false },
      data: { isRead: true },
    })

    return NextResponse.json({ message: "All notifications marked as read" })
  } catch (err) {
    console.error("[PATCH /api/notifications]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
