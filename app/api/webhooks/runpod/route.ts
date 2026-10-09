import { NextRequest, NextResponse } from "next/server"
import { withAudit } from "@/lib/audit"
import { settleBackgroundClean, verifyCleanWebhook } from "@/lib/background-clean"

/**
 * RunPod's report that a background-replacement job has ended (see
 * lib/background-clean.ts). The job id and its signature ride in the URL we
 * gave RunPod when the job was started.
 */
async function handlePOST(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("job") ?? ""
    const signature = req.nextUrl.searchParams.get("sig") ?? ""
    if (!jobId || !verifyCleanWebhook(jobId, signature)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { status } = await req.json() as { status?: string }
    // Progress reports are of no interest; only the end is.
    if (status === "IN_QUEUE" || status === "IN_PROGRESS") return NextResponse.json({ ok: true })
    await settleBackgroundClean(jobId, status === "COMPLETED")
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[POST /api/webhooks/runpod]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
