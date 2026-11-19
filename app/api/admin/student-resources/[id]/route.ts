import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { parseResourceBody, toItem } from "../shared"

type RouteContext = { params: Promise<{ id: string }> }

async function handlePATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    const { id } = await params

    const parsed = parseResourceBody(await req.json(), true)
    if ("error" in parsed) return NextResponse.json({ message: parsed.error }, { status: 400 })

    const existing = await prisma.studentResource.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const row = await prisma.studentResource.update({ where: { id }, data: parsed.data })
    return NextResponse.json({ item: toItem(row) })
  } catch (err) {
    console.error("[PATCH /api/admin/student-resources/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    const { id } = await params

    const { count } = await prisma.studentResource.deleteMany({ where: { id } })
    if (!count) return NextResponse.json({ message: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/admin/student-resources/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
