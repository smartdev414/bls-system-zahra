import { NextRequest, NextResponse } from "next/server"
import {
  createMultipartUpload,
  getPresignedUploadPartUrls,
  completeMultipartUpload,
  abortMultipartUpload,
  publicUrl,
  MULTIPART_MAX_PARTS,
  type CompletedPart,
} from "@/lib/s3"
import { withAudit } from "@/lib/audit"
import { uniqueUploadKey } from "@/lib/upload-filename"
import {
  ALLOWED_CHAT_UPLOAD_TYPES,
  UNSUPPORTED_TYPE_MESSAGE,
  authorizeChatUpload,
  chatUploadPrefix,
  isOwnChatUploadKey,
} from "@/lib/chat-upload-access"

/**
 * Multipart upload for classroom chat attachments — the path a full-length
 * video takes. One route with four actions so the (non-trivial) room-membership
 * check runs once per request in one place:
 *
 *   create   → { key, uploadId }        start the upload
 *   sign     → { urls: [{partNumber,url}] }  presign a batch of part PUTs
 *   complete → { fileUrl }              stitch the parts into the object
 *   abort    → { ok }                   throw away a cancelled/failed upload
 *
 * There is no size cap. S3's own object ceiling (5 TB, 10,000 parts) is the
 * only limit, and the client sizes its parts to stay inside it.
 */

// Sign in batches so a long upload keeps getting fresh 1-hour URLs instead of
// burning through one set signed at the start.
const MAX_PARTS_PER_SIGN_REQUEST = 100

type Body = {
  action?: "create" | "sign" | "complete" | "abort"
  fileName?: string
  contentType?: string
  key?: string
  uploadId?: string
  partNumbers?: number[]
  parts?: CompletedPart[]
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params

    const access = await authorizeChatUpload(sessionId)
    if (!access.ok) return access.response
    const { userId } = access

    const body = await req.json() as Body

    // Every action but `create` addresses an existing upload by key. Re-check
    // ownership here: the key came back through the browser, so it is caller
    // input like any other.
    if (body.action !== "create") {
      if (!body.key || !body.uploadId) {
        return NextResponse.json({ message: "key and uploadId are required" }, { status: 400 })
      }
      if (!isOwnChatUploadKey(body.key, sessionId, userId)) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 })
      }
    }

    switch (body.action) {
      case "create": {
        const { fileName, contentType } = body
        if (!fileName || !contentType) {
          return NextResponse.json(
            { message: "fileName and contentType are required" },
            { status: 400 },
          )
        }
        if (!ALLOWED_CHAT_UPLOAD_TYPES[contentType]) {
          return NextResponse.json(
            { message: `File type "${contentType}" ${UNSUPPORTED_TYPE_MESSAGE}` },
            { status: 400 },
          )
        }
        const key = uniqueUploadKey(chatUploadPrefix(sessionId, userId), fileName)
        const uploadId = await createMultipartUpload(key, contentType)
        return NextResponse.json({ key, uploadId })
      }

      case "sign": {
        const partNumbers = body.partNumbers
        if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
          return NextResponse.json({ message: "partNumbers are required" }, { status: 400 })
        }
        if (partNumbers.length > MAX_PARTS_PER_SIGN_REQUEST) {
          return NextResponse.json(
            { message: `Sign at most ${MAX_PARTS_PER_SIGN_REQUEST} parts per request` },
            { status: 400 },
          )
        }
        if (partNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > MULTIPART_MAX_PARTS)) {
          return NextResponse.json({ message: "Invalid part number" }, { status: 400 })
        }
        const urls = await getPresignedUploadPartUrls(body.key!, body.uploadId!, partNumbers)
        return NextResponse.json({ urls })
      }

      case "complete": {
        const parts = body.parts
        if (!Array.isArray(parts) || parts.length === 0) {
          return NextResponse.json({ message: "parts are required" }, { status: 400 })
        }
        if (parts.some((p) => !p || !Number.isInteger(p.PartNumber) || typeof p.ETag !== "string")) {
          return NextResponse.json({ message: "Invalid part list" }, { status: 400 })
        }
        await completeMultipartUpload(body.key!, body.uploadId!, parts)
        return NextResponse.json({ fileUrl: publicUrl(body.key!) })
      }

      case "abort": {
        await abortMultipartUpload(body.key!, body.uploadId!)
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ message: "Unknown action" }, { status: 400 })
    }
  } catch (err) {
    console.error("[POST /api/sessions/[id]/chat-upload-multipart]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
