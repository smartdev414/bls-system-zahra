import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const isStudent = session.role === "STUDENT"
    const isTutor = session.role === "TUTOR"

    if (!isStudent && !isTutor) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const where = isStudent
      ? { studentId: session.sub }
      : { tutorId: session.sub }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      include: {
        student: { select: { id: true, name: true, avatarUrl: true } },
        tutor:   { select: { id: true, name: true, avatarUrl: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true, senderId: true, isRead: true },
        },
        _count: { select: { messages: { where: { isRead: false, senderId: { not: session.sub } } } } },
      },
    })

    return NextResponse.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        other: isStudent ? c.tutor : c.student,
        lastMessage: c.messages[0] ?? null,
        unreadCount: c._count.messages,
        lastMessageAt: c.lastMessageAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("[GET /api/messages/conversations]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { recipientId } = await req.json() as { recipientId: string }
    if (!recipientId) return NextResponse.json({ message: "recipientId is required" }, { status: 400 })

    const isStudent = session.role === "STUDENT"
    const isTutor = session.role === "TUTOR"

    if (!isStudent && !isTutor) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const studentId = isStudent ? session.sub : recipientId
    const tutorId   = isTutor   ? session.sub : recipientId

    // Upsert conversation
    const conversation = await prisma.conversation.upsert({
      where: { studentId_tutorId: { studentId, tutorId } },
      create: { studentId, tutorId },
      update: {},
      include: {
        student: { select: { id: true, name: true, avatarUrl: true } },
        tutor:   { select: { id: true, name: true, avatarUrl: true } },
      },
    })

    return NextResponse.json({ conversation }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/messages/conversations]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
