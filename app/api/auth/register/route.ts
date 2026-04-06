import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { signToken, setSessionCookie, dashboardPath } from "@/lib/auth"
import { Role } from "@/app/generated/prisma/enums"
import { withAudit } from "@/lib/audit"

async function handlePOST(req: NextRequest) {
  try {
    const { name, email, password, role, inviteToken } = await req.json() as {
      name: string
      email: string
      password: string
      role: string
      inviteToken?: string
    }

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { message: "All fields are required" },
        { status: 400 }
      )
    }

    if (!["STUDENT", "TUTOR"].includes(role)) {
      return NextResponse.json({ message: "Invalid role" }, { status: 400 })
    }

    // Validate invite token when provided
    let invite: { id: string; tutorId: string } | null = null
    if (inviteToken) {
      const fullInvite = await prisma.tutorInvite.findUnique({
        where: { token: inviteToken },
        select: { id: true, tutorId: true, status: true, expiresAt: true },
      })

      if (!fullInvite || fullInvite.status !== "PENDING" || fullInvite.expiresAt < new Date()) {
        return NextResponse.json({ message: "Invalid or expired invitation" }, { status: 400 })
      }
      invite = { id: fullInvite.id, tutorId: fullInvite.tutorId }
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { message: "An account with this email already exists" },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: role as Role,
        ...(invite && { invitedById: invite.tutorId }),
        // Create tutor profile automatically for tutors
        ...(role === "TUTOR" && {
          tutorProfile: { create: {} },
        }),
      },
    })

    // Mark invite as accepted
    if (invite) {
      await prisma.tutorInvite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED" },
      })
    }

    const token = await signToken({
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })

    const res = NextResponse.json(
      { redirectTo: dashboardPath(user.role) },
      { status: 201 }
    )
    setSessionCookie(res, token)
    return res
  } catch (err) {
    console.error("[POST /api/auth/register]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
