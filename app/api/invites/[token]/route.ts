import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"

// GET /api/invites/[token] — validate an invite token (public, no auth required)
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    const invite = await prisma.tutorInvite.findUnique({
      where: { token },
      include: { tutor: { select: { name: true, avatarUrl: true } } },
    })

    if (!invite) {
      return NextResponse.json({ message: "Invalid invitation link" }, { status: 404 })
    }

    if (invite.status === "ACCEPTED") {
      return NextResponse.json({ message: "This invitation has already been used" }, { status: 410 })
    }

    if (invite.expiresAt < new Date()) {
      return NextResponse.json({ message: "This invitation link has expired" }, { status: 410 })
    }

    return NextResponse.json({
      email: invite.email,
      tutorName: invite.tutor.name,
      tutorAvatar: invite.tutor.avatarUrl,
      expiresAt: invite.expiresAt.toISOString(),
    })
  } catch (err) {
    console.error("[GET /api/invites/[token]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
