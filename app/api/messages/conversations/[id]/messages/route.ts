import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id: conversationId } = await params
    const { content } = await req.json() as { content: string }

    if (!content?.trim()) {
      return NextResponse.json({ message: "Message content is required" }, { status: 400 })
    }

    // Verify the sender belongs to this conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ studentId: session.sub }, { tutorId: session.sub }],
      },
    })

    if (!conversation) return NextResponse.json({ message: "Conversation not found" }, { status: 404 })

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          senderId: session.sub,
          content: content.trim(),
        },
        include: {
          sender: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ])

    return NextResponse.json({ message }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/messages/conversations/[id]/messages]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
