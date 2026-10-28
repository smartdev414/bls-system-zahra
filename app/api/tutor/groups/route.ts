import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, isStaff, STAFF_ROLES } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "groups.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    // Staff (admin, support) put students in classes for every tutor, so they
    // see every group. A tutor sees their own plus the ones the office set up —
    // those are the school's class groups, there to be invited to a class but
    // not to be renamed or emptied by a teacher (the write routes refuse).
    const staff = isStaff(session.role)
    const groups = await prisma.studentGroup.findMany({
      where: staff
        ? {}
        : { OR: [{ tutorId: session.sub }, { tutor: { role: { in: [...STAFF_ROLES] } } }] },
      orderBy: { createdAt: "asc" },
      include: {
        tutor: { select: { name: true } },
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
        // Only staff see other people's groups, so only they need to know whose.
        ...(staff ? { tutorName: g.tutor.name } : {}),
        // False for a school group shown to a tutor: usable, not editable.
        canEdit: staff || g.tutorId === session.sub,
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
export const POST = withAudit(tutorWrite("groups", handlePOST))
