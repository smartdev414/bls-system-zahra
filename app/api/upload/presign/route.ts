import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { randomUUID } from "crypto"
import { withAudit } from "@/lib/audit"
import { sanitizeUploadFileName, uniqueUploadKey } from "@/lib/upload-filename"
import { ALLOWED_UPLOAD_TYPES } from "@/lib/upload-types"


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

    const allowed = ALLOWED_UPLOAD_TYPES[contentType]
    if (!allowed) {
      return NextResponse.json({ message: `File type "${contentType}" is not supported` }, { status: 400 })
    }

    // 500 MB cap for a single PUT. Larger files (lesson videos) go through
    // /api/upload/multipart — lib/upload-file.ts picks that path automatically.
    // Browser recordings still come here; the background replacer assumes this cap.
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
