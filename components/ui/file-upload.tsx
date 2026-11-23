"use client"

import { useRef, useState } from "react"
import { Upload, X, Loader2, CheckCircle2, FileText, Video, Image, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { uploadFile } from "@/lib/upload-file"

export type UploadedFile = {
  fileUrl: string
  fileName: string
  fileSize: number
  mimeType: string
  assetType: string
  /** Pre-converted PDF for classroom presentation (PowerPoint uploads only). */
  presentationUrl?: string
  presentationMimeType?: string
}

type Props = {
  accept?: string          // e.g. "video/*,application/pdf"
  label?: string
  onUploaded: (file: UploadedFile) => void
  onRemove?: () => void
  uploaded?: UploadedFile | null
  disabled?: boolean
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("video/")) return Video
  if (mimeType.startsWith("image/")) return Image
  if (mimeType.startsWith("audio/")) return Music
  return FileText
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileUpload({ accept, label = "Upload file", onUploaded, onRemove, uploaded, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Percent sent, or null while there is nothing to measure (images, PowerPoint).
  const [percent, setPercent] = useState<number | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    setPercent(null)

    try {
      onUploaded(await uploadFile(file, { onProgress: (p) => setPercent(p.percent) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      setPercent(null)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  if (uploaded) {
    const Icon = fileIcon(uploaded.mimeType)
    return (
      <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3 overflow-hidden">
        <div className="rounded-lg bg-primary/10 p-2 shrink-0">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-sm font-semibold truncate" title={uploaded.fileName}>
            {uploaded.fileName.length > 30 ? `${uploaded.fileName.substring(0, 30)}...` : uploaded.fileName}
          </p>
          <p className="text-xs text-muted-foreground">{formatBytes(uploaded.fileSize)}</p>
        </div>
        <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
        {onRemove && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={onRemove}
            disabled={disabled}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={uploading || disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          uploading || disabled
            ? "opacity-50 cursor-not-allowed border-muted"
            : "hover:border-primary hover:bg-primary/5 cursor-pointer border-muted-foreground/25"
        )}
      >
        {uploading ? (
          <Loader2 className="size-8 animate-spin text-primary" />
        ) : (
          <Upload className="size-8 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-semibold">
            {uploading ? (percent === null ? "Uploading…" : `Uploading… ${percent}%`) : label}
          </p>
          {uploading && percent !== null && (
            <div className="mx-auto mt-2 h-1.5 w-48 max-w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          )}
          {uploading && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Large videos can take a while. Please keep this page open.
            </p>
          )}
          {!uploading && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Drag & drop or click to browse
            </p>
          )}
        </div>
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ""
        }}
      />
    </div>
  )
}
