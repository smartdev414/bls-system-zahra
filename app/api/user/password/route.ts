import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { currentPassword, newPassword } = await req.json() as {
      currentPassword: string
      newPassword: string
    }

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ message: "Both passwords are required" }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ message: "New password must be at least 8 characters" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, passwordHash: true },
    })

    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 })

    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) return NextResponse.json({ message: "Current password is incorrect" }, { status: 400 })

    const hash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: session.sub }, data: { passwordHash: hash } })

    return NextResponse.json({ message: "Password updated successfully" })
  } catch (err) {
    console.error("[PUT /api/user/password]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
