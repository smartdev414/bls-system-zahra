import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { backgroundCleanConfigured, startBackgroundClean } from "@/lib/background-clean"
import { rawKeyFromUrl } from "@/lib/background-clean-keys"

// Fallback colour for a raw recording that somehow has no job to copy it from.
const DEFAULT_COLOR = "#374151"

/** Run background replacement again for a video whose first attempt failed. */
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    if (!backgroundCleanConfigured()) return NextResponse.json({ message: "Not configured" }, { status: 503 })

    const { url } = await req.json() as { url?: string }
    const rawKey = typeof url === "string" ? rawKeyFromUrl(url) : null
    if (!rawKey) return NextResponse.json({ message: "Not a recording" }, { status: 400 })

    const existing = await prisma.videoCleanJob.findUnique({ where: { rawKey } })
    // Tutors retry their own recordings; admins can retry anyone's.
    const ownerId = existing?.userId ?? rawKey.split("/")[1]
    if (session.role !== "ADMIN" && ownerId !== session.sub) {
      return NextResponse.json({ message: "Not a recording of yours" }, { status: 403 })
    }
    if (existing && existing.status !== "FAILED") {
      return NextResponse.json({ state: existing.status === "DONE" ? "done" : "processing" })
    }

    const job = await startBackgroundClean(rawKey, ownerId, existing?.color ?? DEFAULT_COLOR)
    return NextResponse.json({ state: job.status === "FAILED" ? "failed" : "processing" })
  } catch (err) {
    console.error("[POST /api/upload/clean-background/retry]", err)
    return NextResponse.json({ message: "Could not retry background replacement" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
