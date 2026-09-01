import { NextRequest, NextResponse } from "next/server"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { withAudit } from "@/lib/audit"
import { uniqueUploadKey } from "@/lib/upload-filename"
import {
  ALLOWED_CHAT_UPLOAD_TYPES,
  UNSUPPORTED_TYPE_MESSAGE,
  authorizeChatUpload,
  chatUploadPrefix,
} from "@/lib/chat-upload-access"

// A single presigned PUT is capped by S3 itself at 5 GB. There is no app-level
// size limit on chat attachments any more: anything past SINGLE_PUT_MAX_SIZE —
// and, in practice, anything past a few MB — goes through the multipart route
// next door, which has no ceiling worth naming.
const SINGLE_PUT_MAX_SIZE = 5 * 1024 * 1024 * 1024

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params

    const access = await authorizeChatUpload(sessionId)
    if (!access.ok) return access.response

    const { fileName, contentType, fileSize } = await req.json() as {
      fileName: string
      contentType: string
      fileSize: number
    }

    if (!fileName || !contentType) {
      return NextResponse.json({ message: "fileName and contentType are required" }, { status: 400 })
    }

    if (!ALLOWED_CHAT_UPLOAD_TYPES[contentType]) {
      return NextResponse.json(
        { message: `File type "${contentType}" ${UNSUPPORTED_TYPE_MESSAGE}` },
        { status: 400 },
      )
    }

    if (fileSize > SINGLE_PUT_MAX_SIZE) {
      return NextResponse.json(
        { message: "Files over 5 GB must be uploaded in parts" },
        { status: 400 },
      )
    }

    // Preserve the original filename in the S3 key (UUID folder keeps it unique).
    const key = uniqueUploadKey(chatUploadPrefix(sessionId, access.userId), fileName)

    const presignedUrl = await getPresignedUploadUrl(key, contentType)
    const fileUrl = publicUrl(key)

    return NextResponse.json({ presignedUrl, fileUrl })
  } catch (err) {
    console.error("[POST /api/sessions/[id]/chat-upload-presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
