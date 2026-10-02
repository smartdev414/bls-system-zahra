import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, ownerScope } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"

async function handlePATCH(
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
    const { name } = await req.json() as { name: string }
    if (!name?.trim()) return NextResponse.json({ message: "Group name is required" }, { status: 400 })

    const group = await prisma.studentGroup.findFirst({ where: { id, ...ownerScope(session) } })
    if (!group) return NextResponse.json({ message: "Group not found" }, { status: 404 })

    const updated = await prisma.studentGroup.update({
      where: { id },
      data: { name: name.trim() },
    })

    return NextResponse.json({ group: { id: updated.id, name: updated.name } })
  } catch (err) {
    console.error("[PATCH /api/tutor/groups/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "groups.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const group = await prisma.studentGroup.findFirst({ where: { id, ...ownerScope(session) } })
    if (!group) return NextResponse.json({ message: "Group not found" }, { status: 404 })

    await prisma.studentGroup.delete({ where: { id } })
    return NextResponse.json({ message: "Group deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/groups/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
