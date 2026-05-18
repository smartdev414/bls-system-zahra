import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { publicUrl, uploadObject } from "@/lib/s3"
import { finishPptxToPdfJob } from "@/lib/cloudconvert"
import { withAudit } from "@/lib/audit"

export const maxDuration = 300

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = (await req.json()) as { jobId?: string; pdfKey?: string }
    const { jobId, pdfKey } = body
    if (!jobId || !pdfKey) {
      return NextResponse.json({ message: "jobId and pdfKey are required" }, { status: 400 })
    }

    // Only allow writing under this tutor's documents folder.
    const prefix = `documents/${session.sub}/`
    if (!pdfKey.startsWith(prefix) || !pdfKey.endsWith("/presentation.pdf")) {
      return NextResponse.json({ message: "Invalid pdfKey" }, { status: 400 })
    }

    const pdfBuffer = await finishPptxToPdfJob(jobId)
    await uploadObject(pdfKey, pdfBuffer, "application/pdf")

    return NextResponse.json({
      presentationUrl: publicUrl(pdfKey),
      presentationMimeType: "application/pdf",
      presentationSize: pdfBuffer.byteLength,
    })
  } catch (err) {
    console.error("[POST /api/upload/convert]", err)
    const message = err instanceof Error ? err.message : "Conversion failed"
    return NextResponse.json({ message }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
