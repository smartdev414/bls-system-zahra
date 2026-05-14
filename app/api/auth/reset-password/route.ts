import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"

const MIN_PASSWORD_LENGTH = 8

async function handleGET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")
    if (!token) {
      return NextResponse.json({ message: "Token is required" }, { status: 400 })
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: { select: { email: true, name: true } } },
    })

    if (!record) {
      return NextResponse.json(
        { message: "This reset link is invalid." },
        { status: 404 }
      )
    }

    if (record.usedAt) {
      return NextResponse.json(
        { message: "This reset link has already been used." },
        { status: 410 }
      )
    }

    if (record.expiresAt < new Date()) {
      return NextResponse.json(
        { message: "This reset link has expired." },
        { status: 410 }
      )
    }

    return NextResponse.json({
      email: record.user.email,
      name: record.user.name,
      expiresAt: record.expiresAt.toISOString(),
    })
  } catch (err) {
    console.error("[GET /api/auth/reset-password]", err)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const { token, password } = (await req.json()) as {
      token?: string
      password?: string
    }

    if (!token || !password) {
      return NextResponse.json(
        { message: "Token and new password are required" },
        { status: 400 }
      )
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        {
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        },
        { status: 400 }
      )
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
    })

    if (!record) {
      return NextResponse.json(
        { message: "This reset link is invalid." },
        { status: 404 }
      )
    }

    if (record.usedAt) {
      return NextResponse.json(
        { message: "This reset link has already been used." },
        { status: 410 }
      )
    }

    if (record.expiresAt < new Date()) {
      return NextResponse.json(
        { message: "This reset link has expired." },
        { status: 410 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate any other outstanding tokens for this user.
      prisma.passwordResetToken.updateMany({
        where: {
          userId: record.userId,
          id: { not: record.id },
          usedAt: null,
        },
        data: { usedAt: new Date() },
      }),
    ])

    return NextResponse.json({
      message: "Your password has been reset. You can now sign in.",
    })
  } catch (err) {
    console.error("[POST /api/auth/reset-password]", err)
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    )
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
