import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { parseReceptiveInput } from "@/lib/receptive-log"
import { ENTRY_SELECT, toDbDate, toEntry } from "@/lib/receptive-log-server"

// PUT    /api/student/receptive-log/:id — change one of the student's own entries.
// DELETE /api/student/receptive-log/:id — remove it.

type Ctx = { params: Promise<{ id: string }> }

async function ownEntry(id: string) {
  const session = await getSession()
  if (!session) return { res: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  if (session.role !== "STUDENT") return { res: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  const found = await prisma.receptiveLog.count({ where: { id, userId: session.sub } })
  if (!found) return { res: NextResponse.json({ message: "Entry not found" }, { status: 404 }) }
  return { session }
}

async function handlePUT(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    const { res } = await ownEntry(id)
    if (res) return res

    const input = parseReceptiveInput(await req.json().catch(() => null))
    if ("error" in input) return NextResponse.json({ message: input.error }, { status: 400 })

    const row = await prisma.receptiveLog.update({
      where: { id },
      data: { ...input, date: toDbDate(input.date) },
      select: ENTRY_SELECT,
    })
    return NextResponse.json({ entry: toEntry(row) })
  } catch (err) {
    console.error("[PUT /api/student/receptive-log/:id]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    const { res } = await ownEntry(id)
    if (res) return res
    await prisma.receptiveLog.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/student/receptive-log/:id]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
