import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { publicUrl, uploadObject } from "@/lib/s3"
import { finishPptxToPdfJob } from "@/lib/cloudconvert"
import { withAudit } from "@/lib/audit"

// Vercel function timeout — PPTX → PDF can take 20-60s on large decks.
// Pro plans allow up to 300s; Hobby caps at 60.
export const maxDuration = 300

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...hostedBy(session.sub) },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const body = (await req.json()) as { jobId?: string; sourceFileName?: string }
    const { jobId, sourceFileName } = body
    if (!jobId || !sourceFileName) {
      return NextResponse.json({ message: "jobId and sourceFileName are required" }, { status: 400 })
    }

    const pdfBuffer = await finishPptxToPdfJob(jobId)

    // A fresh key per upload, so a second deck in the same session never
    // reuses the first one's URL and can't be served from a stale cache.
    const pdfKey = `slides/${id}/${randomUUID()}/presentation.pdf`
    await uploadObject(pdfKey, pdfBuffer, "application/pdf")

    const pdfFileName = sourceFileName.replace(/\.pptx?$/i, "") + ".pdf"

    return NextResponse.json({
      fileUrl:  publicUrl(pdfKey),
      key:      pdfKey,
      fileName: pdfFileName,
      mimeType: "application/pdf",
      fileSize: pdfBuffer.byteLength,
    })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/slides/convert]", err)
    const message = err instanceof Error ? err.message : "Conversion failed"
    return NextResponse.json({ message }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
