import { NextRequest, NextResponse } from "next/server"
import { getPresignedUploadUrl, publicUrl } from "@/lib/s3"
import { withAudit } from "@/lib/audit"
import { uniqueUploadKey } from "@/lib/upload-filename"
import { authorizeChatUpload } from "@/lib/chat-upload-access"

/**
 * Presign a PUT for a picture (or clip) dropped onto the shared whiteboard.
 *
 * The board syncs by putting tldraw record diffs straight onto the LiveKit data
 * channel, so an asset has to be somewhere every client can fetch it from —
 * tldraw's own default keeps it as a blob/data URL that only resolves in the
 * tab it was dropped into. Everything lands in the same bucket the chat
 * attachments use, under its own prefix so a whiteboard image is never mistaken
 * for something that was sent to the class.
 *
 * The gate is the chat-attachment one: the question it answers ("may this
 * caller put a file into this session?") is exactly the same, and the two must
 * not drift apart.
 */

// tldraw's own asset ceiling is well under this; the cap is here so a presign
// can't be used to push an arbitrary object into the bucket.
const MAX_ASSET_SIZE = 100 * 1024 * 1024

// What tldraw can actually place on a board. SVG is included because tldraw
// sanitizes it before handing it over, and it is rendered as an image.
const ALLOWED_WHITEBOARD_ASSET_TYPES: Record<string, true> = {
  "image/jpeg": true,
  "image/png": true,
  "image/webp": true,
  "image/gif": true,
  "image/avif": true,
  "image/bmp": true,
  "image/svg+xml": true,
  "video/mp4": true,
  "video/webm": true,
  "video/quicktime": true,
}

/** Every whiteboard asset for a session lives under this prefix, namespaced by uploader. */
function whiteboardAssetPrefix(sessionId: string, userId: string): string {
  return `classroom-whiteboard/${sessionId}/${userId}`
}

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

    if (!ALLOWED_WHITEBOARD_ASSET_TYPES[contentType]) {
      return NextResponse.json(
        { message: `File type "${contentType}" can't be added to the whiteboard.` },
        { status: 400 },
      )
    }

    if (typeof fileSize === "number" && fileSize > MAX_ASSET_SIZE) {
      return NextResponse.json(
        { message: "That file is too large for the whiteboard." },
        { status: 400 },
      )
    }

    const key = uniqueUploadKey(whiteboardAssetPrefix(sessionId, access.userId), fileName)

    const presignedUrl = await getPresignedUploadUrl(key, contentType)
    const fileUrl = publicUrl(key)

    return NextResponse.json({ presignedUrl, fileUrl })
  } catch (err) {
    console.error("[POST /api/sessions/[id]/whiteboard-asset-presign]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
