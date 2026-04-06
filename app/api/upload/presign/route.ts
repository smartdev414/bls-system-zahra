import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { randomUUID } from "crypto"
import { withAudit } from "@/lib/audit"

// Allowed MIME types and their S3 folder prefix
const ALLOWED: Record<string, { prefix: string; assetType: string }> = {
  "video/mp4":        { prefix: "videos",    assetType: "VIDEO" },
  "video/webm":       { prefix: "videos",    assetType: "VIDEO" },
  "video/quicktime":  { prefix: "videos",    assetType: "VIDEO" },
  "application/pdf":  { prefix: "documents", assetType: "PDF" },
  "image/jpeg":       { prefix: "images",    assetType: "IMAGE" },
  "image/png":        { prefix: "images",    assetType: "IMAGE" },
  "image/webp":       { prefix: "images",    assetType: "IMAGE" },
  "audio/mpeg":       { prefix: "audio",     assetType: "AUDIO" },
  "audio/wav":        { prefix: "audio",     assetType: "AUDIO" },
  "text/vtt":         { prefix: "subtitles", assetType: "SUBTITLE" },
  "application/msword":                                                       { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":  { prefix: "documents", assetType: "DOCUMENT" },
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

    const ext = fileName.split(".").pop() ?? "bin"
    const key = `${allowed.prefix}/${session.sub}/${randomUUID()}.${ext}`

    const presignedUrl = await getPresignedUploadUrl(key, contentType)
    const fileUrl = publicUrl(key)

    return NextResponse.json({ presignedUrl, fileUrl, key, assetType: allowed.assetType })
  } catch (err) {
    console.error("[POST /api/upload/presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
