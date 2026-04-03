import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { signToken, setSessionCookie, dashboardPath } from "@/lib/auth"

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, role } = await req.json()

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { message: "All fields are required" },
        { status: 400 }
      )
    }

    if (!["STUDENT", "TUTOR"].includes(role)) {
      return NextResponse.json({ message: "Invalid role" }, { status: 400 })
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
        role,
        // Create tutor profile automatically for tutors
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
    return res
  } catch (err) {
    console.error("[POST /api/auth/register]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
