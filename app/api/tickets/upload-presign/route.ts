import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { randomUUID } from "crypto"
import { withAudit } from "@/lib/audit"

const ALLOWED: Record<string, { prefix: string }> = {
  "image/jpeg":       { prefix: "tickets" },
  "image/png":        { prefix: "tickets" },
  "image/webp":       { prefix: "tickets" },
  "image/gif":        { prefix: "tickets" },
  "video/mp4":        { prefix: "tickets" },
  "video/webm":       { prefix: "tickets" },
  "video/quicktime":  { prefix: "tickets" },
  "application/pdf":  { prefix: "tickets" },
}

// 50 MB cap for ticket attachments
const MAX_SIZE = 50 * 1024 * 1024

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

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

    if (fileSize > MAX_SIZE) {
      return NextResponse.json({ message: "File too large (max 50 MB)" }, { status: 400 })
    }

    const ext = fileName.split(".").pop() ?? "bin"
    const key = `${allowed.prefix}/${session.sub}/${randomUUID()}.${ext}`

    const presignedUrl = await getPresignedUploadUrl(key, contentType)
    const fileUrl = publicUrl(key)

    return NextResponse.json({ presignedUrl, fileUrl })
  } catch (err) {
    console.error("[POST /api/tickets/upload-presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
