import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { parseResourceBody, toItem, type ResourceInput } from "./shared"

/**
 * The students' extra material — exam samples, videos, slides — that admins
 * file into folders for /student/resources.
 */

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const rows = await prisma.studentResource.findMany({ orderBy: { createdAt: "desc" } })
    return NextResponse.json({ items: rows.map(toItem) })
  } catch (err) {
    console.error("[GET /api/admin/student-resources]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const parsed = parseResourceBody(await req.json(), false)
    if ("error" in parsed) return NextResponse.json({ message: parsed.error }, { status: 400 })
    const data = parsed.data as ResourceInput

    const row = await prisma.studentResource.create({ data: { ...data, addedById: session.sub } })
    return NextResponse.json({ item: toItem(row) }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/admin/student-resources]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
