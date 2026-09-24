import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { signToken, setSessionCookie, dashboardPath } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handlePOST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      return NextResponse.json(
        { message: "Invalid email or password" },
        { status: 401 }
      )
    }

    if (!user.passwordHash) {
      return NextResponse.json(
        { message: "This account uses Google sign-in. Please continue with Google." },
        { status: 401 }
      )
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
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


    const res = NextResponse.json({ redirectTo: dashboardPath(user.role) })
    setSessionCookie(res, token)
    return res
  } catch (err) {
    console.error("[POST /api/auth/login]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
