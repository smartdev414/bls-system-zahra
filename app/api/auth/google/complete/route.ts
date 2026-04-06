import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import {
  signToken,
  setSessionCookie,
  dashboardPath,
  verifyPendingGoogleToken,
  clearPendingGoogleCookie,
  getPendingGoogleToken,
} from "@/lib/auth"
import { withAudit } from "@/lib/audit"

type Role = "STUDENT" | "TUTOR"

async function handlePOST(req: NextRequest) {
  try {
    const { role, agreed } = (await req.json()) as { role: Role; agreed: boolean }

    if (!role || !["STUDENT", "TUTOR"].includes(role)) {
      return NextResponse.json({ message: "Invalid role" }, { status: 400 })
    }
    if (!agreed) {
      return NextResponse.json({ message: "You must accept the terms" }, { status: 400 })
    }

    const rawToken = await getPendingGoogleToken()
    if (!rawToken) {
      return NextResponse.json(
        { message: "Session expired. Please try signing in with Google again." },
        { status: 400 }
      )
    }

    const pending = await verifyPendingGoogleToken(rawToken)
    if (!pending) {
      return NextResponse.json(
        { message: "Session expired. Please try signing in with Google again." },
        { status: 400 }
      )
    }

    // If the email was registered in the meantime, just link and log in
    const existing = await prisma.user.findUnique({ where: { email: pending.email } })
    if (existing) {
      const user = await prisma.user.update({
        where: { id: existing.id },
        data: { googleId: pending.googleId },
      })
      const token = await signToken({
        sub: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      })
      const res = NextResponse.json({ redirectTo: dashboardPath(user.role) })
      setSessionCookie(res, token)
      clearPendingGoogleCookie(res)
      return res
    }

    const user = await prisma.user.create({
      data: {
        name: pending.name,
        email: pending.email,
        passwordHash: null,
        googleId: pending.googleId,
        avatarUrl: pending.avatarUrl ?? null,
        role,
        ...(role === "TUTOR" && {
          tutorProfile: { create: {} },
        }),
      },
    })

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
    clearPendingGoogleCookie(res)
    return res
  } catch (err) {
    console.error("[POST /api/auth/google/complete]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
