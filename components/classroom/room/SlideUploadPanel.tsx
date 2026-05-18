"use client"

import { useState, useRef } from "react"
import { Presentation, Upload, X, Loader2 } from "lucide-react"
import type { UploadedSlides } from "./types"

export function SlideUploadPanel({
  sessionId,
  onSlidesReady,
  onClose,
  previousSlides,
}: {
  sessionId: string
  onSlidesReady: (data: UploadedSlides) => void
  onClose: () => void
  previousSlides: UploadedSlides | null
}) {
  const [uploading, setUploading]   = useState(false)
  const [progress, setProgress]     = useState("")
  const [error, setError]           = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError("")

    const isVideo = file.type.startsWith("video/")
    const isPptx  =
      file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      file.type === "application/vnd.ms-powerpoint"

    setUploading(true)

    try {
      let registerUrl      = ""
      let registerName     = file.name
      let registerMime     = file.type
      let registerSize: number | null = file.size

      if (isPptx) {
        // PowerPoint: upload straight to CloudConvert (no S3 hop for the deck).
        // The server only mints upload credentials; the API key never leaves the backend.
        setProgress("Preparing conversion…")
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

        setProgress("Uploading slides…")
        const ccForm = new FormData()
        for (const [key, value] of Object.entries(uploadParameters)) {
          ccForm.append(key, value)
        }
        ccForm.append("file", file)

        const ccUploadRes = await fetch(uploadUrl, { method: "POST", body: ccForm })
        if (!ccUploadRes.ok) throw new Error("Upload to conversion service failed")

        setProgress("Converting slides to PDF…")
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
        setProgress("Getting upload URL…")
        const presignRes = await fetch(`/api/tutor/sessions/${sessionId}/slides/presign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, mimeType: file.type }),
        })
        if (!presignRes.ok) {
          const err = await presignRes.json()
          throw new Error(err.message ?? "Could not get upload URL")
        }
        const { uploadUrl, fileUrl } = await presignRes.json() as {
          uploadUrl: string; fileUrl: string
        }

        setProgress(isVideo ? "Uploading video…" : "Uploading file…")
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        })
        if (!uploadRes.ok) throw new Error("Upload to storage failed")

        registerUrl = fileUrl
      }

      // 3. Register the file in the session
      setProgress(isVideo ? "Registering video…" : "Registering slides…")
      const registerRes = await fetch(`/api/tutor/sessions/${sessionId}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileUrl:  registerUrl,
          fileName: registerName,
          mimeType: registerMime,
          fileSize: registerSize,
        }),
      })
      if (!registerRes.ok) {
        const err = await registerRes.json()
        throw new Error(err.message ?? "Could not save slides")
      }

      // Videos skip the slide-counting step — they're played, not paged.
      if (isVideo) {
        onSlidesReady({ kind: "video", url: registerUrl, mimeType: registerMime, fileName: registerName })
        return
      }

      // 4. Determine slide/page count. After PPTX conversion the registered
      // file is always a PDF, so the PDF branch handles it via the URL.
      setProgress("Reading slide count…")
      let total: number

      if (isPptx) {
        // Fetch the converted PDF to count pages — the original PPTX is gone.
        const pdfjsLib = await import("pdfjs-dist")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
          `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
        const pdf = await pdfjsLib.getDocument({ url: registerUrl, withCredentials: false }).promise
        total = pdf.numPages
      } else if (file.type === "application/pdf") {
        const pdfjsLib = await import("pdfjs-dist")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
          `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        total = pdf.numPages
      } else {
        // Defensive fallback — shouldn't hit this path now that PPTX is converted.
        const JSZip = (await import("jszip")).default
        const zip = await JSZip.loadAsync(file)
        const slideFiles = Object.keys(zip.files).filter(
          (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)
        )
        total = slideFiles.length || 1
      }

      onSlidesReady({ kind: "slides", url: registerUrl, total, mimeType: registerMime, fileName: registerName })
    } catch (err: unknown) {
      setError((err as Error).message ?? "Upload failed")
    } finally {
      setUploading(false)
      setProgress("")
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Presentation className="size-4 text-primary" />
            <h3 className="font-bold text-sm text-white">Upload Slides</h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-4">
          Upload a PDF, PowerPoint, or video file (MP4, MOV, WebM). Students will see it alongside your camera.
        </p>

        {error && (
          <p className="text-xs text-rose-400 bg-rose-900/20 border border-rose-800/40 rounded-lg px-3 py-2 mb-4">
            {error}
          </p>
        )}

        {uploading ? (
          <div className="flex items-center gap-3 py-4 justify-center text-zinc-400">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span className="text-sm">{progress}</span>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.ppt,.pptx,.mp4,.mov,.webm,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-zinc-700 hover:border-primary/60 hover:bg-primary/5 text-zinc-400 hover:text-primary transition-all text-sm font-medium"
            >
              <Upload className="size-4" />
              Choose file (PDF, PPTX, MP4, MOV, WebM)
            </button>

            {previousSlides && (
              <button
                onClick={() => onSlidesReady(previousSlides)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-all text-sm font-medium mt-3"
              >
                <Presentation className="size-4" />
                Resume previous {previousSlides.kind === "video" ? "video" : "slides"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
