import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ count: 0 })

    const count = await prisma.message.count({
      where: {
        isRead: false,
        senderId: { not: session.sub },
        conversation: session.role === "STUDENT"
          ? { studentId: session.sub }
          : { tutorId: session.sub },
      },
    })

    return NextResponse.json({ count })
  } catch {
    return NextResponse.json({ count: 0 })
  }
}

export const GET = withAudit(handleGET)
