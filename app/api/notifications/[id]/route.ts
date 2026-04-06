import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// PATCH /api/notifications/[id] — mark a single notification as read
async function handlePATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const notification = await prisma.notification.findFirst({
      where: { id, userId: session.sub },
    })
    if (!notification) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })

    return NextResponse.json({ notification: updated })
  } catch (err) {
    console.error("[PATCH /api/notifications/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/notifications/[id] — dismiss a notification
async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const notification = await prisma.notification.findFirst({
      where: { id, userId: session.sub },
    })
    if (!notification) return NextResponse.json({ message: "Not found" }, { status: 404 })

    await prisma.notification.delete({ where: { id } })
    return NextResponse.json({ message: "Deleted" })
  } catch (err) {
    console.error("[DELETE /api/notifications/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
