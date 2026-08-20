import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { uploadObject, publicUrl } from "@/lib/s3"
import { withAudit } from "@/lib/audit"
import { uniqueUploadKeyWithExt } from "@/lib/upload-filename"
import sharp from "sharp"

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB input limit
const ALLOWED_INPUT = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const contentType = req.headers.get("content-type") ?? ""
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json({ message: "Expected multipart/form-data" }, { status: 400 })
    }

    const form = await req.formData()
    const file = form.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Missing file field" }, { status: 400 })
    }

    if (!ALLOWED_INPUT.has(file.type)) {
      return NextResponse.json({ message: `Unsupported image type: ${file.type}` }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ message: "Image too large (max 10 MB)" }, { status: 400 })
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer())

    // Convert to WebP — quality 85, strip metadata
    const webpBuffer = await sharp(inputBuffer)
      .webp({ quality: 85 })
      .withMetadata({ orientation: undefined }) // strip EXIF but keep orientation corrected
      .toBuffer()

    // Keep the original basename (e.g. "homework-photo.webp") so the URL does
    // not end in a bare UUID. Content is still converted to WebP.
    const key = uniqueUploadKeyWithExt(`images/${session.sub}`, file.name, "webp")
    await uploadObject(key, webpBuffer, "image/webp", { CacheControl: "public, max-age=31536000" })

    return NextResponse.json({
      fileUrl: publicUrl(key),
      fileName: file.name,
      assetType: "IMAGE",
    })
  } catch (err) {
    console.error("[POST /api/upload/image]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
