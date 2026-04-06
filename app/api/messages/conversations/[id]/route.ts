import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        OR: [{ studentId: session.sub }, { tutorId: session.sub }],
      },
      include: {
        student: { select: { id: true, name: true, avatarUrl: true } },
        tutor:   { select: { id: true, name: true, avatarUrl: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            sender: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    })

    if (!conversation) return NextResponse.json({ message: "Conversation not found" }, { status: 404 })

    // Mark incoming messages as read
    await prisma.message.updateMany({
      where: {
        conversationId: id,
        senderId: { not: session.sub },
        isRead: false,
      },
      data: { isRead: true },
    })

    return NextResponse.json({ conversation })
  } catch (err) {
    console.error("[GET /api/messages/conversations/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
