import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { parseReceptiveInput } from "@/lib/receptive-log"
import { ENTRY_SELECT, receptiveLogOf, toDbDate, toEntry } from "@/lib/receptive-log-server"

// GET  /api/student/receptive-log — the student's own receptive log, with totals.
// POST /api/student/receptive-log — add an entry.

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    return NextResponse.json(await receptiveLogOf(session.sub))
  } catch (err) {
    console.error("[GET /api/student/receptive-log]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const input = parseReceptiveInput(await req.json().catch(() => null))
    if ("error" in input) return NextResponse.json({ message: input.error }, { status: 400 })

    const row = await prisma.receptiveLog.create({
      data: { ...input, date: toDbDate(input.date), userId: session.sub },
      select: ENTRY_SELECT,
    })
    return NextResponse.json({ entry: toEntry(row) }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/student/receptive-log]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
