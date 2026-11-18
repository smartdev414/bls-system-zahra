import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { signToken, setSessionCookie, dashboardPath } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { recordLogin } from "@/lib/activity-tracking"

async function handlePOST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 }
      )
    }

    // Match the address however it was capitalised (phones add a capital).
    const user = await prisma.user.findFirst({
      where: { email: { equals: String(email).trim(), mode: "insensitive" } },
    })

    if (!user) {
      await recordLogin(req, { method: "PASSWORD", email, success: false, failureReason: "unknown-email" })
      return NextResponse.json(
        { message: "Invalid email or password" },
        { status: 401 }
      )
    }

    if (!user.passwordHash) {
      await recordLogin(req, { method: "PASSWORD", email, userId: user.id, success: false, failureReason: "google-only-account" })
      return NextResponse.json(
        { message: "This account uses Google sign-in. Please continue with Google." },
        { status: 401 }
      )
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await recordLogin(req, { method: "PASSWORD", email, userId: user.id, success: false, failureReason: "wrong-password" })
      return NextResponse.json(
        { message: "Invalid email or password" },
        { status: 401 }
      )
    }

    const token = await signToken({
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })
    await recordLogin(req, { method: "PASSWORD", email: user.email, userId: user.id, success: true })

    const res = NextResponse.json({ redirectTo: dashboardPath(user.role) })
    setSessionCookie(res, token)
    return res
  } catch (err) {
    console.error("[POST /api/auth/login]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
