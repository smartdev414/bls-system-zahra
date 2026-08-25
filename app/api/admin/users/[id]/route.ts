import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, roleLabel, type AppRole } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "users.edit")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    if (id === session.sub) {
      return NextResponse.json({ message: "Cannot modify your own account" }, { status: 400 })
    }

    const body = await req.json() as {
      role?: AppRole
      isVerified?: boolean
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 })

    // Handing out (or taking away) a staff role is admin-only — otherwise
    // support staff could promote themselves to full access.
    const touchesStaffRole =
      (body.role && (body.role === "ADMIN" || body.role === "SUPPORT")) ||
      user.role === "ADMIN" ||
      user.role === "SUPPORT"
    if (touchesStaffRole && !can(session.role, "users.assignStaffRole")) {
      return NextResponse.json(
        { message: `Only an administrator can change a ${roleLabel(user.role)} account` },
        { status: 403 },
      )
    }

    if (body.role) {
      await prisma.user.update({ where: { id }, data: { role: body.role } })
      // Ensure TutorProfile exists if promoting to TUTOR
      if (body.role === "TUTOR") {
        await prisma.tutorProfile.upsert({
          where: { userId: id },
          create: { userId: id },
          update: {},
        })
      }
    }

    if (typeof body.isVerified === "boolean" && user.role === "TUTOR") {
      await prisma.tutorProfile.update({
        where: { userId: id },
        data: { isVerified: body.isVerified },
      })
    }

    const updated = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true,
        tutorProfile: { select: { isVerified: true } },
      },
    })

    return NextResponse.json({ user: updated })
  } catch (err) {
    console.error("[PATCH /api/admin/users/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "users.delete")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    if (id === session.sub) {
      return NextResponse.json({ message: "Cannot delete your own account" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 })

    await prisma.user.delete({ where: { id } })
    return NextResponse.json({ message: "User deleted" })
  } catch (err) {
    console.error("[DELETE /api/admin/users/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
