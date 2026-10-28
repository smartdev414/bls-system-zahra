"use client"

import { useRef, useState } from "react"
import { FileText, Loader2, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { uploadFile } from "@/lib/upload-file"

// A file that goes with a presentation's task — a PDF, a picture, a Word
// document or a PowerPoint — which students open before they present.

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.doc,.docx,.ppt,.pptx,application/pdf,image/jpeg,image/png,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"

const isImage = (url: string) => /\.(webp|jpe?g|png|gif)$/i.test(new URL(url, "http://x").pathname)

/** The name the file was uploaded with — the last part of its address. */
function fileName(url: string) {
  const last = new URL(url, "http://x").pathname.split("/").pop() ?? "file"
  try {
    return decodeURIComponent(last).replace(/_/g, " ")
  } catch {
    return last
  }
}

/** The file as students (and teachers looking at the test) see it: a picture, or a link to open. */
export function TaskFileLink({ url }: { url: string }) {
  if (isImage(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="self-start">
        <img src={url} alt="The task" className="max-h-[50vh] w-auto rounded-lg border object-contain" />
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="self-start inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
    >
      <FileText className="size-4 text-primary shrink-0" />
      <span className="break-all">{fileName(url)}</span>
    </a>
  )
}

/** The builder's field: add the file, see it, take it off. */
export function TaskFileField({ value, onChange, onUploadingChange }: {
  value: string | null
  onChange: (url: string | null) => void
  onUploadingChange?: (uploading: boolean) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setUploading(true)
    onUploadingChange?.(true)
    setError(null)
    try {
      onChange((await uploadFile(file, { convertPowerPoint: false })).fileUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      onUploadingChange?.(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>A file with the task (optional)</Label>
      {value ? (
        <div className="flex items-start gap-2">
          <TaskFileLink url={value} />
          <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Remove the file" onClick={() => onChange(null)}>
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" className="self-start" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Paperclip className="size-3.5 mr-1.5" />}
          {uploading ? "Uploading…" : "Add file"}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = "" }}
      />
      <p className="text-xs text-muted-foreground">PDF, picture, Word or PowerPoint. Students can open it before they start.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
