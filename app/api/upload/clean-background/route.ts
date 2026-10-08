import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { backgroundCleanConfigured, backgroundCleanStatus, submitBackgroundClean } from "@/lib/background-clean"
import { isRawRecordingKey } from "@/lib/background-clean-keys"
import { LOGO_MARK_SRC } from "@/components/layout/logo"

// Background replacement after upload — see lib/background-clean.ts.

async function staffSession() {
  const session = await getSession()
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  if (session.role !== "TUTOR" && session.role !== "ADMIN") {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }
  return { session }
}

/**
 * Without `jobId`: whether the recorders should use this at all.
 * With it: how that job is getting on. Polled by the recorder, so not audited.
 */
export async function GET(req: NextRequest) {
  try {
    const { error } = await staffSession()
    if (error) return error

    const jobId = req.nextUrl.searchParams.get("jobId")
    if (!jobId) return NextResponse.json({ available: backgroundCleanConfigured() })
    if (!backgroundCleanConfigured()) return NextResponse.json({ message: "Not configured" }, { status: 503 })
    return NextResponse.json({ status: await backgroundCleanStatus(jobId) })
  } catch (err) {
    console.error("[GET /api/upload/clean-background]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const { session, error } = await staffSession()
    if (error) return error
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

    const jobId = await submitBackgroundClean(segments.join("/"), color, LOGO_MARK_SRC)
    return NextResponse.json({ jobId })
  } catch (err) {
    console.error("[POST /api/upload/clean-background]", err)
    return NextResponse.json({ message: "Could not start background replacement" }, { status: 502 })
  }
}

export const POST = withAudit(handlePOST)
