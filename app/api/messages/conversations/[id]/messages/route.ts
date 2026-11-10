import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { triggerNewMessage, triggerUserEvent } from "@/lib/pusher-server"
import { withAudit } from "@/lib/audit"
import { inBackground, sendPushToUser } from "@/lib/push"

async function handlePOST(
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

    const recipientId = conversation.studentId === session.sub
      ? conversation.tutorId
      : conversation.studentId

    // Push real-time events (fire-and-forget — don't block the response)
    void triggerNewMessage(conversationId, message)
    void triggerUserEvent(recipientId, "new-message", {
      conversationId,
      senderId: session.sub,
      senderName: session.name,
    })
    // Lock-screen notification on the recipient's phone (app or browser)
    const recipientArea = recipientId === conversation.studentId ? "student" : "tutor"
    const text = content.trim()
    inBackground(() =>
      sendPushToUser(recipientId, {
        title: session.name ? `Message from ${session.name}` : "New message",
        body: text.length > 140 ? `${text.slice(0, 137)}…` : text,
        url: `/${recipientArea}/messages?conversation=${conversationId}`,
        tag: `conversation-${conversationId}`,
      }),
    )

    return NextResponse.json({ message }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/messages/conversations/[id]/messages]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
