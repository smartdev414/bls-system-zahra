import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { sendEmail } from "@/lib/email"
import { tutorInviteEmail } from "@/lib/email-templates"
import { withAudit } from "@/lib/audit"

const INVITE_EXPIRY_DAYS = 365

// POST /api/tutor/invites — send invitation emails to a list of addresses
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { emails } = await req.json() as { emails: string[] }
    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ message: "Provide at least one email address" }, { status: 400 })
    }
    if (emails.length > 50) {
      return NextResponse.json({ message: "Maximum 50 invitations per request" }, { status: 400 })
    }

    // Normalise and deduplicate
    const normalised = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]

    // Skip emails that already have accounts
    const existing = await prisma.user.findMany({
      where: { email: { in: normalised } },
      select: { email: true },
    })
    const existingEmails = new Set(existing.map((u) => u.email))
    const toInvite = normalised.filter((e) => !existingEmails.has(e))

    if (toInvite.length === 0) {
      return NextResponse.json({
        message: "All provided emails already have accounts",
        skipped: normalised,
        sent: [],
      })
    }

    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

    // For each email: if a PENDING invite already exists for this tutor+email, refresh it;
    // otherwise create a new one (generates a fresh token).
    const invites = await Promise.all(
      toInvite.map(async (email) => {
        const existing = await prisma.tutorInvite.findFirst({
          where: { tutorId: session.sub, email, status: "PENDING" },
        })
        if (existing) {
          return prisma.tutorInvite.update({
            where: { id: existing.id },
            data: { expiresAt, createdAt: new Date() },
          })
        }
        return prisma.tutorInvite.create({ data: { tutorId: session.sub, email, expiresAt } })
      }),
    )

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
    const tutor = await prisma.user.findUnique({ where: { id: session.sub }, select: { name: true } })
    const tutorName = tutor?.name ?? "Your tutor"

    // Send emails fire-and-forget
    void Promise.all(
      invites.map((invite) => {
        const inviteUrl = `${appUrl}/invite/${invite.token}`
        const { subject, html } = tutorInviteEmail(tutorName, inviteUrl, INVITE_EXPIRY_DAYS, 12)
        return sendEmail(invite.email, subject, html).catch((e) =>
          console.error("[tutor/invites] email send failed", invite.email, e),
        )
      }),
    )

    return NextResponse.json({
      sent: toInvite,
      skipped: normalised.filter((e) => existingEmails.has(e)),
    }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/invites]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// GET /api/tutor/invites — list sent invitations
async function handleGET(_req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const invites = await prisma.tutorInvite.findMany({
      where: { tutorId: session.sub },
      orderBy: { createdAt: "desc" },
      take: 100,
    })

    // Mark expired ones
    const now = new Date()
    const enriched = invites.map((inv) => ({
      ...inv,
      status: inv.status === "PENDING" && inv.expiresAt < now ? "EXPIRED" : inv.status,
    }))

    return NextResponse.json({ invites: enriched })
  } catch (err) {
    console.error("[GET /api/tutor/invites]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
