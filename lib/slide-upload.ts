// Shared client-side pipeline for getting a presentation into a live session.
//
// Two callers use it: the in-class "Present" panel, and the pre-class prep card
// on the session page. They must behave identically — a deck prepared the night
// before is the same resource, stored the same way, as one uploaded mid-lesson.
//
// The route a file takes depends on its type:
//   PPTX  → straight to CloudConvert (no S3 hop), converted to PDF, registered
//   PDF   → presigned S3 upload, registered
//   video → presigned S3 upload, registered, no page counting

import type { UploadedSlides } from "@/components/classroom/room/types"
import { openPdf } from "@/lib/pdfjs"

export type UploadProgress = (message: string) => void

/** Read a PDF's page count in the browser, without shipping it to the server. */
export async function countPdfPages(url: string): Promise<number> {
  const pdf = await openPdf(url)
  return pdf.numPages
}

export function isPptxFile(file: File): boolean {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    file.type === "application/vnd.ms-powerpoint"
  )
}

/**
 * Some browsers (notably Windows Chrome/Edge) hand over `.mp4` / Office files
 * with an empty or generic MIME. The presign route keys off the MIME, so guess
 * from the extension before we talk to the server.
 */
const EXT_MIME: Record<string, string> = {
  pdf:  "application/pdf",
  ppt:  "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4:  "video/mp4",
  mov:  "video/quicktime",
  webm: "video/webm",
}

export function presentationMime(file: File): string {
  if (
    file.type === "application/pdf" ||
    file.type.startsWith("video/") ||
    isPptxFile(file)
  ) {
    return file.type
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return EXT_MIME[ext] ?? file.type
}

/**
 * Upload a slide deck or video and register it as the session's presentation.
 * Resolves with everything the classroom needs to start presenting it.
 */
export async function uploadPresentation(
  sessionId: string,
  file: File,
  onProgress: UploadProgress = () => {},
): Promise<UploadedSlides> {
  const mime = presentationMime(file)
  const isVideo = mime.startsWith("video/")
  const isPptx  =
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint"

  let registerUrl  = ""
  let registerName = file.name
  let registerMime = mime
  let registerSize: number | null = file.size

  if (isPptx) {
    // PowerPoint: upload straight to CloudConvert (no S3 hop for the deck). The
    // server only mints upload credentials; the API key never leaves the backend.
    onProgress("Preparing conversion…")
    const presignRes = await fetch(
      `/api/tutor/sessions/${sessionId}/slides/convert/presign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceFileName: file.name }),
      },
    )
    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}))
      throw new Error(err.message ?? "Could not start conversion")
    }
    const { jobId, uploadUrl, uploadParameters } = await presignRes.json() as {
      jobId: string
      uploadUrl: string
      uploadParameters: Record<string, string>
    }

    onProgress("Uploading slides…")
    const ccForm = new FormData()
    for (const [key, value] of Object.entries(uploadParameters)) {
      ccForm.append(key, value)
    }
    ccForm.append("file", file)

    const ccUploadRes = await fetch(uploadUrl, { method: "POST", body: ccForm })
    if (!ccUploadRes.ok) throw new Error("Upload to conversion service failed")

    onProgress("Converting slides to PDF…")
    const convertRes = await fetch(`/api/tutor/sessions/${sessionId}/slides/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, sourceFileName: file.name }),
    })
    if (!convertRes.ok) {
      const err = await convertRes.json().catch(() => ({}))
      throw new Error(err.message ?? "Could not convert PPTX to PDF")
    }
    const converted = await convertRes.json() as {
      fileUrl: string; fileName: string; mimeType: string; fileSize: number
    }
    registerUrl  = converted.fileUrl
    registerName = converted.fileName
    registerMime = converted.mimeType
    registerSize = converted.fileSize
  } else {
    // PDF / video: presigned upload to S3, then register.
    onProgress("Getting upload URL…")
    const presignRes = await fetch(`/api/tutor/sessions/${sessionId}/slides/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, mimeType: mime }),
    })
    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}))
      throw new Error(err.message ?? "Could not get upload URL")
    }
    const { uploadUrl, fileUrl } = await presignRes.json() as {
      uploadUrl: string; fileUrl: string
    }

    onProgress(isVideo ? "Uploading video…" : "Uploading file…")
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: file,
    })
    if (!uploadRes.ok) throw new Error("Upload to storage failed")

    registerUrl = fileUrl
  }

  onProgress(isVideo ? "Registering video…" : "Registering slides…")
  await registerPresentation(sessionId, {
    fileUrl:  registerUrl,
    fileName: registerName,
    mimeType: registerMime,
    fileSize: registerSize,
  })

  // Videos skip the page count — they're played, not paged.
  if (isVideo) {
    return { kind: "video", url: registerUrl, mimeType: registerMime, fileName: registerName }
  }

  onProgress("Reading slide count…")
  let total: number

  if (isPptx || mime === "application/pdf") {
    // After PPTX conversion the registered file is always a PDF.
    total = await countPdfPages(registerUrl)
  } else {
    // Defensive fallback — shouldn't hit this path now that PPTX is converted.
    const JSZip = (await import("jszip")).default
    const zip = await JSZip.loadAsync(file)
    const slideFiles = Object.keys(zip.files).filter(
      (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name),
    )
    total = slideFiles.length || 1
  }

  return { kind: "slides", url: registerUrl, total, mimeType: registerMime, fileName: registerName }
}

/**
 * Save (or replace) the session's presentation record. Re-registering the same
 * file with `selectedPages` is how a prepared deck records which slides the
 * tutor picked — the endpoint replaces the row, so this stays a single write.
 */
export async function registerPresentation(
  sessionId: string,
  body: {
    fileUrl: string
    fileName: string
    mimeType: string
    fileSize?: number | null
    selectedPages?: number[]
    totalPages?: number
  },
): Promise<void> {
  const res = await fetch(`/api/tutor/sessions/${sessionId}/slides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message ?? "Could not save slides")
  }
}

/** The presentation resource as the API returns it. */
export type PreparedPresentation = {
  id: string
  fileUrl: string
  fileName: string
  mimeType: string | null
  fileSize: number | null
  selectedPages: number[] | null
  totalPages: number | null
}

/** Fetch whatever presentation is currently prepared for a session, if any. */
export async function fetchPreparedPresentation(
  sessionId: string,
): Promise<PreparedPresentation | null> {
  const res = await fetch(`/api/tutor/sessions/${sessionId}/slides`)
  if (!res.ok) return null
  const data = await res.json() as { resource: PreparedPresentation | null }
  return data.resource ?? null
}

/** Turn a stored resource into the shape the classroom presents from. */
export function toUploadedSlides(resource: PreparedPresentation): UploadedSlides | null {
  if (!resource.mimeType) return null
  if (resource.mimeType.startsWith("video/")) {
    return {
      kind: "video",
      url: resource.fileUrl,
      mimeType: resource.mimeType,
      fileName: resource.fileName,
    }
  }
  if (!resource.totalPages || resource.totalPages < 1) return null
  return {
    kind: "slides",
    url: resource.fileUrl,
    total: resource.totalPages,
    mimeType: resource.mimeType,
    fileName: resource.fileName,
  }
}
