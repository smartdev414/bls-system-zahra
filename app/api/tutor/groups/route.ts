import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "groups.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const groups = await prisma.studentGroup.findMany({
      where: { tutorId: session.sub },
      orderBy: { createdAt: "asc" },
      include: {
        members: {
          include: {
            student: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
          orderBy: { addedAt: "asc" },
        },
      },
    })

    return NextResponse.json({
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        createdAt: g.createdAt.toISOString(),
        members: g.members.map((m) => ({
          id: m.student.id,
          name: m.student.name,
          email: m.student.email,
          avatarUrl: m.student.avatarUrl,
        })),
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/groups]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "groups.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { name } = await req.json() as { name: string }
    if (!name?.trim()) return NextResponse.json({ message: "Group name is required" }, { status: 400 })

    const group = await prisma.studentGroup.create({
      data: { tutorId: session.sub, name: name.trim() },
      include: { members: true },
    })

    return NextResponse.json({ group: { id: group.id, name: group.name, createdAt: group.createdAt.toISOString(), members: [] } }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/groups]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
