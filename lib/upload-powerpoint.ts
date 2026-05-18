// Client-side helper: upload a PPT/PPTX, convert to PDF via CloudConvert, return both URLs.

export type PowerPointUploadResult = {
  fileUrl: string
  fileName: string
  fileSize: number
  mimeType: string
  assetType: string
  presentationUrl: string
  presentationMimeType: string
}

export function isPowerPointMime(mimeType: string): boolean {
  return (
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
}

export async function uploadPowerPointFile(file: File): Promise<PowerPointUploadResult> {
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
  })
  if (!presignRes.ok) {
    const err = await presignRes.json() as { message?: string }
    throw new Error(err.message ?? "Could not get upload URL")
  }

  const { presignedUrl, fileUrl, pdfKey, assetType } = await presignRes.json() as {
    presignedUrl: string
    fileUrl: string
    pdfKey?: string
    assetType: string
  }
  if (!pdfKey) throw new Error("Server did not return a PDF storage path")

  const uploadRes = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  })
  if (!uploadRes.ok) throw new Error("Upload to storage failed")

  const ccPresignRes = await fetch("/api/upload/convert/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceFileName: file.name }),
  })
  if (!ccPresignRes.ok) {
    const err = await ccPresignRes.json().catch(() => ({})) as { message?: string }
    throw new Error(err.message ?? "Could not start conversion")
  }

  const { jobId, uploadUrl, uploadParameters } = await ccPresignRes.json() as {
    jobId: string
    uploadUrl: string
    uploadParameters: Record<string, string>
  }

  const ccForm = new FormData()
  for (const [key, value] of Object.entries(uploadParameters)) {
    ccForm.append(key, value)
  }
  ccForm.append("file", file)

  const ccUploadRes = await fetch(uploadUrl, { method: "POST", body: ccForm })
  if (!ccUploadRes.ok) throw new Error("Upload to conversion service failed")

  const convertRes = await fetch("/api/upload/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, pdfKey }),
  })
  if (!convertRes.ok) {
    const err = await convertRes.json().catch(() => ({})) as { message?: string }
    throw new Error(err.message ?? "Could not convert PowerPoint to PDF")
  }

  const converted = await convertRes.json() as {
    presentationUrl: string
    presentationMimeType: string
  }

  return {
    fileUrl,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    assetType,
    presentationUrl: converted.presentationUrl,
    presentationMimeType: converted.presentationMimeType,
  }
}
