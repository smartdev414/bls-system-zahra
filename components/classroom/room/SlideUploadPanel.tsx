"use client"

import { useState, useRef, useEffect } from "react"
import { Presentation, Upload, X, Loader2, FileText } from "lucide-react"
import type { UploadedSlides } from "./types"
import { countPdfPages, uploadPresentation } from "@/lib/slide-upload"

type SessionMaterial = {
  id: string
  fileName: string
  presentationUrl: string | null
  presentationMimeType: string | null
}

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
  const [materials, setMaterials]   = useState<SessionMaterial[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/tutor/sessions/${sessionId}/resources`)
      .then((r) => r.json())
      .then((d: { resources: SessionMaterial[] }) => {
        setMaterials(
          (d.resources ?? []).filter(
            (r) => r.presentationUrl && r.presentationMimeType === "application/pdf",
          ),
        )
      })
      .catch(() => {})
  }, [sessionId])

  const presentFromMaterial = async (material: SessionMaterial) => {
    setError("")
    setUploading(true)
    setProgress("Loading pre-converted slides…")
    try {
      const total = await countPdfPages(material.presentationUrl!)
      const pdfName = material.fileName.replace(/\.pptx?$/i, "") + ".pdf"
      onSlidesReady({
        kind: "slides",
        url: material.presentationUrl!,
        total,
        mimeType: "application/pdf",
        fileName: pdfName,
      })
    } catch (err: unknown) {
      setError((err as Error).message ?? "Could not load slides")
    } finally {
      setUploading(false)
      setProgress("")
    }
  }

  const handleFile = async (file: File) => {
    setError("")
    setUploading(true)
    try {
      const result = await uploadPresentation(sessionId, file, setProgress)
      onSlidesReady(result)
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

            {materials.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Session materials (pre-converted)
                </p>
                {materials.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => presentFromMaterial(m)}
                    className="w-full flex items-center gap-2 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-left text-sm text-zinc-200 transition-colors"
                  >
                    <FileText className="size-4 text-primary shrink-0" />
                    <span className="truncate">{m.fileName}</span>
                  </button>
                ))}
              </div>
            )}

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
