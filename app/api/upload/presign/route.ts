import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { randomUUID } from "crypto"
import { withAudit } from "@/lib/audit"
import { sanitizeUploadFileName, uniqueUploadKey } from "@/lib/upload-filename"

// Allowed MIME types and their S3 folder prefix
// Images are NOT listed here — they go through /api/upload/image for WebP conversion
const ALLOWED: Record<string, { prefix: string; assetType: string }> = {
  "video/mp4":        { prefix: "videos",    assetType: "VIDEO" },
  "video/webm":       { prefix: "videos",    assetType: "VIDEO" },
  "video/quicktime":  { prefix: "videos",    assetType: "VIDEO" },
  "application/pdf":  { prefix: "documents", assetType: "PDF" },
  "audio/mpeg":       { prefix: "audio",     assetType: "AUDIO" },
  "audio/wav":        { prefix: "audio",     assetType: "AUDIO" },
  "text/vtt":         { prefix: "subtitles", assetType: "SUBTITLE" },
  "application/msword":                                                       { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":  { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.ms-powerpoint":                                            { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { prefix: "documents", assetType: "DOCUMENT" },
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { fileName, contentType, fileSize } = await req.json() as {
      fileName: string
      contentType: string
      fileSize: number
    }

    if (!fileName || !contentType) {
      return NextResponse.json({ message: "fileName and contentType are required" }, { status: 400 })
    }

    const allowed = ALLOWED[contentType]
    if (!allowed) {
      return NextResponse.json({ message: `File type "${contentType}" is not supported` }, { status: 400 })
    }

    // 500 MB cap
    if (fileSize > 500 * 1024 * 1024) {
      return NextResponse.json({ message: "File too large (max 500 MB)" }, { status: 400 })
    }

    const isPowerPoint =
      contentType === "application/vnd.ms-powerpoint" ||
      contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"

    // Keep the original filename as the final path segment so downloads/openers
    // show e.g. "Lesson Intro.mp4" instead of a UUID. Uniqueness comes from the
    // UUID folder. PowerPoint shares that folder with the converted PDF.
    const folderId = randomUUID()
    const safeName = sanitizeUploadFileName(fileName)
    const key = isPowerPoint
      ? `${allowed.prefix}/${session.sub}/${folderId}/${safeName}`
      : uniqueUploadKey(`${allowed.prefix}/${session.sub}`, fileName)
    const pdfKey = isPowerPoint
      ? `${allowed.prefix}/${session.sub}/${folderId}/presentation.pdf`
      : undefined

    const presignedUrl = await getPresignedUploadUrl(key, contentType)
    const fileUrl = publicUrl(key)

    return NextResponse.json({ presignedUrl, fileUrl, key, pdfKey, assetType: allowed.assetType })
  } catch (err) {
    console.error("[POST /api/upload/presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
