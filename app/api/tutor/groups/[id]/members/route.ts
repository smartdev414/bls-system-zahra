import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, ownerScope } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { onGroupMembersAdded, onGroupMembersRemoved } from "@/lib/course-groups"

// Add members to group
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "groups.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { studentIds } = await req.json() as { studentIds: string[] }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ message: "studentIds must be a non-empty array" }, { status: 400 })
    }

    const group = await prisma.studentGroup.findFirst({ where: { id, ...ownerScope(session) } })
    if (!group) return NextResponse.json({ message: "Group not found" }, { status: 404 })

    // Only real students can be group members.
    const students = await prisma.user.findMany({
      where: { id: { in: [...new Set(studentIds)] }, role: "STUDENT" },
      select: { id: true },
    })
    const memberIds = students.map((s) => s.id)

    // Upsert all members (idempotent)
    await prisma.studentGroupMember.createMany({
      data: memberIds.map((studentId) => ({ groupId: id, studentId })),
      skipDuplicates: true,
    })
    // If the group is on a course, its new members join the course and the
    // group's upcoming classes.
    await onGroupMembersAdded(id, memberIds, session)

    return NextResponse.json({ message: "Members added" })
  } catch (err) {
    console.error("[POST /api/tutor/groups/[id]/members]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// Remove members from group
async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "groups.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const { studentIds } = await req.json() as { studentIds: string[] }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ message: "studentIds must be a non-empty array" }, { status: 400 })
    }

    const group = await prisma.studentGroup.findFirst({ where: { id, ...ownerScope(session) } })
    if (!group) return NextResponse.json({ message: "Group not found" }, { status: 404 })

    await prisma.studentGroupMember.deleteMany({
      where: { groupId: id, studentId: { in: studentIds } },
    })
    await onGroupMembersRemoved(id, studentIds)

    return NextResponse.json({ message: "Members removed" })
  } catch (err) {
    console.error("[DELETE /api/tutor/groups/[id]/members]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
