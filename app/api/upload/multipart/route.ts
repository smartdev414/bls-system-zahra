import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
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
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/upload-types"

/**
 * Multipart counterpart of /api/upload/presign for tutor/admin uploads (lesson
 * videos, library files). A single presigned PUT of a large video is slow,
 * all-or-nothing and gives no progress; this lets the browser send parts in
 * parallel straight to S3. Same four actions as the classroom chat route:
 *
 *   create   → { key, uploadId, assetType }
 *   sign     → { urls: [{partNumber,url}] }
 *   complete → { fileUrl }
 *   abort    → { ok }
 */

const MAX_PARTS_PER_SIGN_REQUEST = 100
const PREFIXES = [...new Set(Object.values(ALLOWED_UPLOAD_TYPES).map((t) => t.prefix))]

type Body = {
  action?: "create" | "sign" | "complete" | "abort"
  fileName?: string
  contentType?: string
  fileSize?: number
  key?: string
  uploadId?: string
  partNumbers?: number[]
  parts?: CompletedPart[]
}

/** The key came back through the browser — only accept one in the caller's own folders. */
function isOwnKey(key: string, userId: string): boolean {
  if (key.includes("..")) return false
  return PREFIXES.some((prefix) => key.startsWith(`${prefix}/${userId}/`))
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = await req.json() as Body

    if (body.action !== "create") {
      if (!body.key || !body.uploadId) {
        return NextResponse.json({ message: "key and uploadId are required" }, { status: 400 })
      }
      if (!isOwnKey(body.key, session.sub)) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 })
      }
    }

    switch (body.action) {
      case "create": {
        const { fileName, contentType, fileSize } = body
        if (!fileName || !contentType) {
          return NextResponse.json({ message: "fileName and contentType are required" }, { status: 400 })
        }
        const allowed = ALLOWED_UPLOAD_TYPES[contentType]
        if (!allowed) {
          return NextResponse.json({ message: `File type "${contentType}" is not supported` }, { status: 400 })
        }
        if (typeof fileSize === "number" && fileSize > MAX_UPLOAD_BYTES) {
          return NextResponse.json({ message: `File too large (max ${MAX_UPLOAD_LABEL})` }, { status: 400 })
        }
        const key = uniqueUploadKey(`${allowed.prefix}/${session.sub}`, fileName)
        const uploadId = await createMultipartUpload(key, contentType)
        return NextResponse.json({ key, uploadId, assetType: allowed.assetType })
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
    console.error("[POST /api/upload/multipart]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
