import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { releasedHandoutsFor } from "@/lib/class-handouts"

// The class handouts this student can open now (Resources page).
async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    return NextResponse.json({ handouts: await releasedHandoutsFor(session.sub) })
  } catch (err) {
    console.error("[GET /api/student/handouts]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
