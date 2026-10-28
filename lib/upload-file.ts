// Client-side helper: upload one file the same way <FileUpload> does, for
// screens that take several files at once (the resource library).
//
// Images go through the server for WebP conversion, PowerPoint is converted to a
// PDF for the classroom, and everything else is a presigned S3 PUT.
// `convertPowerPoint: false` keeps a deck as it is, for files students just open.

import type { UploadedFile } from "@/components/ui/file-upload"
import { isPowerPointMime, uploadPowerPointFile } from "@/lib/upload-powerpoint"

export async function uploadFile(file: File, { convertPowerPoint = true } = {}): Promise<UploadedFile> {
  if (convertPowerPoint && isPowerPointMime(file.type)) {
    const result = await uploadPowerPointFile(file)
    return {
      fileUrl: result.fileUrl,
      fileName: result.fileName,
      fileSize: result.fileSize,
      mimeType: result.mimeType,
      assetType: result.assetType,
      presentationUrl: result.presentationUrl,
      presentationMimeType: result.presentationMimeType,
    }
  }

  let fileUrl: string
  let assetType: string

  if (file.type.startsWith("image/")) {
    const form = new FormData()
    form.append("file", file)
    const res = await fetch("/api/upload/image", { method: "POST", body: form })
    if (!res.ok) {
      const err = await res.json() as { message?: string }
      throw new Error(err.message ?? "Image upload failed")
    }
    const json = await res.json() as { fileUrl: string; assetType: string }
    fileUrl = json.fileUrl
    assetType = json.assetType
  } else {
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
    })
    if (!presignRes.ok) {
      const err = await presignRes.json() as { message?: string }
      throw new Error(err.message ?? "Could not get upload URL")
    }
    const { presignedUrl, fileUrl: url, assetType: at } = await presignRes.json() as {
      presignedUrl: string; fileUrl: string; assetType: string
    }
    const uploadRes = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
    if (!uploadRes.ok) throw new Error("Upload to S3 failed")
    fileUrl = url
    assetType = at
  }

  const finalMime = file.type.startsWith("image/") ? "image/webp" : file.type
  return { fileUrl, fileName: file.name, fileSize: file.size, mimeType: finalMime, assetType }
}
