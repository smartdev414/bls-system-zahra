import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { backgroundCleanConfigured, startBackgroundClean } from "@/lib/background-clean"
import { isRawRecordingKey } from "@/lib/background-clean-keys"

// Background replacement after upload — see lib/background-clean.ts.

/** Whether the recorders should use this at all. */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  return NextResponse.json({
    available: (session.role === "TUTOR" || session.role === "ADMIN") && backgroundCleanConfigured(),
  })
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    if (!backgroundCleanConfigured()) return NextResponse.json({ message: "Not configured" }, { status: 503 })

    const { key, color } = await req.json() as { key?: string; color?: string }
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
      return NextResponse.json({ message: "color must be #rrggbb" }, { status: 400 })
    }
    // Only a raw recording this user has just uploaded: `videos/{userId}/{uuid}/{name}.raw.webm`.
    const segments = typeof key === "string" ? key.split("/") : []
    if (
      segments.length !== 4 || segments[0] !== "videos" || segments[1] !== session.sub ||
      segments.some((s) => s === "" || s === "." || s === "..") || !isRawRecordingKey(segments[3])
    ) {
      return NextResponse.json({ message: "Not a recording of yours" }, { status: 400 })
    }

    const job = await startBackgroundClean(segments.join("/"), session.sub, color)
    return NextResponse.json({ state: job.status === "FAILED" ? "failed" : "processing" })
  } catch (err) {
    console.error("[POST /api/upload/clean-background]", err)
    return NextResponse.json({ message: "Could not start background replacement" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
