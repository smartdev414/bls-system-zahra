import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@/app/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { assertCanAccessSession } from "@/lib/session-access"

const MAX_MESSAGES = 500
const ALLOWED_TYPES = new Set(["text", "reaction", "system"])

type AttachmentBody = {
  fileUrl?: unknown
  fileName?: unknown
  fileSize?: unknown
  mimeType?: unknown
}

function serializeMessage(row: {
  id: string
  fromName: string
  text: string
  type: string
  attachment: Prisma.JsonValue | null
  createdAt: Date
}) {
  const attachment =
    row.attachment && typeof row.attachment === "object" && !Array.isArray(row.attachment)
      ? (row.attachment as {
          fileUrl: string
          fileName: string
          fileSize: number
          mimeType: string
        })
      : undefined

  return {
    id: row.id,
    from: row.fromName,
    text: row.text,
    type: row.type,
    ts: row.createdAt.getTime(),
    ...(attachment ? { attachment } : {}),
  }
}

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getSession()
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id: sessionId } = await params
    const access = await assertCanAccessSession(auth, sessionId)
    if (access.error) return access.error

    const rows = await prisma.liveSessionChatMessage.findMany({
      where: { sessionId },
      // Newest-first with a cap, reversed below: a busy lesson can outgrow
      // MAX_MESSAGES, and a late joiner needs the recent conversation rather
      // than the first minutes of class.
      orderBy: { createdAt: "desc" },
      take: MAX_MESSAGES,
      select: {
        id: true,
        fromName: true,
        text: true,
        type: true,
        attachment: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ messages: rows.reverse().map(serializeMessage) })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/chat]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getSession()
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id: sessionId } = await params
    const access = await assertCanAccessSession(auth, sessionId)
    if (access.error) return access.error

    if (
      access.liveSession.status === "CANCELLED" ||
      access.liveSession.status === "COMPLETED"
    ) {
      return NextResponse.json({ message: "Session is no longer active" }, { status: 410 })
    }

    const body = await req.json() as {
      id?: unknown
      from?: unknown
      text?: unknown
      type?: unknown
      ts?: unknown
      attachment?: AttachmentBody | null
    }

    const id = typeof body.id === "string" ? body.id.trim() : ""
    const fromName = typeof body.from === "string" ? body.from.trim() : ""
    const text = typeof body.text === "string" ? body.text : ""
    const type = typeof body.type === "string" ? body.type : "text"

    if (!id || id.length > 64) {
      return NextResponse.json({ message: "id is required" }, { status: 400 })
    }
    if (!fromName || fromName.length > 120) {
      return NextResponse.json({ message: "from is required" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ message: "Invalid message type" }, { status: 400 })
    }
    if (text.length > 4000) {
      return NextResponse.json({ message: "Message too long" }, { status: 400 })
    }

    let attachment: Prisma.InputJsonValue | undefined
    if (body.attachment && typeof body.attachment === "object") {
      const a = body.attachment
      if (
        typeof a.fileUrl !== "string" ||
        typeof a.fileName !== "string" ||
        typeof a.fileSize !== "number" ||
        typeof a.mimeType !== "string"
      ) {
        return NextResponse.json({ message: "Invalid attachment" }, { status: 400 })
      }
      attachment = {
        fileUrl: a.fileUrl,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
      }
    }

    if (!text.trim() && !attachment && type === "text") {
      return NextResponse.json({ message: "Empty message" }, { status: 400 })
    }

    const createdAt =
      typeof body.ts === "number" && Number.isFinite(body.ts)
        ? new Date(body.ts)
        : new Date()

    // Idempotent upsert so a retry after a flaky network doesn't duplicate the
    // same live-broadcast message in history.
    const row = await prisma.liveSessionChatMessage.upsert({
      where: { id },
      create: {
        id,
        sessionId,
        senderId: auth.sub,
        fromName,
        text,
        type,
        attachment,
        createdAt,
      },
      update: {},
      select: {
        id: true,
        fromName: true,
        text: true,
        type: true,
        attachment: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ message: serializeMessage(row) })
  } catch (err) {
    console.error("[POST /api/sessions/[id]/chat]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
