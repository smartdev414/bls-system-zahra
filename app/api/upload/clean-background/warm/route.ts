import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { warmBackgroundWorker } from "@/lib/background-clean"

// A recorder has opened: have a worker ready for its first take.
async function handlePOST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    await warmBackgroundWorker()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[POST /api/upload/clean-background/warm]", err)
    return NextResponse.json({ message: "Could not start a worker" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
