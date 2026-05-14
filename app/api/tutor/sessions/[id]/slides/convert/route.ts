import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import {
  getPresignedDownloadUrl,
  publicUrl,
  uploadObject,
  deleteObject,
} from "@/lib/s3"
import { convertPptxToPdf } from "@/lib/cloudconvert"
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
      where: { id, tutorId: session.sub },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const body = (await req.json()) as { sourceKey?: string; sourceFileName?: string }
    const { sourceKey, sourceFileName } = body
    if (!sourceKey || !sourceFileName) {
      return NextResponse.json({ message: "sourceKey and sourceFileName are required" }, { status: 400 })
    }

    // Constrain the source key to this session's slides folder so a tutor can't
    // ask the server to convert arbitrary objects in the bucket.
    if (!sourceKey.startsWith(`slides/${id}/`)) {
      return NextResponse.json({ message: "Invalid sourceKey" }, { status: 400 })
    }

    // CloudConvert needs to fetch the source over HTTP. A short-lived presigned
    // GET works whether the bucket is private or public.
    const sourceUrl = await getPresignedDownloadUrl(sourceKey, 1800)
    const pdfBuffer = await convertPptxToPdf(sourceUrl, sourceFileName)

    const pdfKey = `slides/${id}/presentation.pdf`
    await uploadObject(pdfKey, pdfBuffer, "application/pdf")

    // Drop the original PPTX so we don't keep duplicate storage. Failure to
    // delete isn't fatal — the converted PDF is what the viewer will use.
    if (sourceKey !== pdfKey) {
      deleteObject(sourceKey).catch(() => { /* ignore */ })
    }

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
