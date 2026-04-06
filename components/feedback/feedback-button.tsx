"use client"

import { useState, useRef } from "react"
import {
  MessageSquarePlus, X, Bug, Lightbulb, Sparkles, HelpCircle,
  Paperclip, Loader2, CheckCircle2, Image, Video, FileText, Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketType = "BUG" | "FEATURE" | "SUGGESTION" | "OTHER"

type AttachedFile = {
  fileUrl: string
  fileName: string
  fileSize: number
  mimeType: string
}

const TICKET_TYPES: { value: TicketType; label: string; desc: string; icon: React.ElementType; color: string }[] = [
  { value: "BUG",        label: "Bug Report",   desc: "Something is broken",     icon: Bug,          color: "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-400" },
  { value: "FEATURE",    label: "Feature",      desc: "New capability needed",   icon: Sparkles,     color: "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-400" },
  { value: "SUGGESTION", label: "Suggestion",   desc: "Idea to improve things",  icon: Lightbulb,    color: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400" },
  { value: "OTHER",      label: "Other",        desc: "General feedback",        icon: HelpCircle,   color: "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400" },
]

const SELECTED_COLORS: Record<TicketType, string> = {
  BUG:        "border-rose-500 bg-rose-50 ring-2 ring-rose-300",
  FEATURE:    "border-violet-500 bg-violet-50 ring-2 ring-violet-300",
  SUGGESTION: "border-amber-500 bg-amber-50 ring-2 ring-amber-300",
  OTHER:      "border-blue-500 bg-blue-50 ring-2 ring-blue-300",
}

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf",
])

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("video/")) return Video
  if (mimeType.startsWith("image/")) return Image
  return FileText
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── FeedbackModal ─────────────────────────────────────────────────────────────

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"type" | "form">("type")
  const [type, setType] = useState<TicketType | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return
    const remaining = 5 - attachments.length
    const toUpload = Array.from(files).slice(0, remaining)

    for (const file of toUpload) {
      if (!ALLOWED_MIME.has(file.type)) {
        toast.error(`"${file.name}" is not a supported file type`)
        continue
      }
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds 50 MB`)
        continue
      }

      setUploading(true)
      try {
        const presignRes = await fetch("/api/tickets/upload-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
        })
        if (!presignRes.ok) {
          const err = await presignRes.json() as { message?: string }
          throw new Error(err.message ?? "Could not get upload URL")
        }
        const { presignedUrl, fileUrl } = await presignRes.json() as { presignedUrl: string; fileUrl: string }

        const uploadRes = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        })
        if (!uploadRes.ok) throw new Error("Upload failed")

        setAttachments((prev) => [
          ...prev,
          { fileUrl, fileName: file.name, fileSize: file.size, mimeType: file.type },
        ])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed")
      } finally {
        setUploading(false)
      }
    }
  }

  async function handleSubmit() {
    if (!type || !title.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), type, attachments }),
      })
      if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? "Submission failed")
      }
      setDone(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit feedback")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8 px-6 text-center">
        <div className="size-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="size-8 text-emerald-600" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Thank you!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Your feedback has been submitted. We'll look into it shortly.
          </p>
        </div>
        <Button onClick={onClose} className="mt-2">Close</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <div className="flex items-center gap-2">
          {step === "form" && (
            <button
              onClick={() => setStep("type")}
              className="text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
            >
              ← Back
            </button>
          )}
          <h2 className="text-base font-bold">{step === "type" ? "Send Feedback" : "Tell us more"}</h2>
        </div>
        <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-4 flex flex-col gap-4">
        {step === "type" ? (
          <>
            <p className="text-sm text-muted-foreground">What kind of feedback would you like to share?</p>
            <div className="grid grid-cols-2 gap-2">
              {TICKET_TYPES.map(({ value, label, desc, icon: Icon, color }) => (
                <button
                  key={value}
                  onClick={() => { setType(value); setStep("form") }}
                  className={cn(
                    "flex flex-col items-start gap-1.5 rounded-xl border-2 p-3 text-left transition-all",
                    color,
                    type === value && SELECTED_COLORS[value],
                  )}
                >
                  <Icon className="size-4" />
                  <span className="text-sm font-semibold leading-tight">{label}</span>
                  <span className="text-xs opacity-70 leading-tight">{desc}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Selected type badge */}
            {type && (() => {
              const t = TICKET_TYPES.find((x) => x.value === type)!
              return (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("gap-1.5 text-xs", t.color)}>
                    <t.icon className="size-3" />
                    {t.label}
                  </Badge>
                </div>
              )
            })()}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Title</label>
              <Input
                placeholder="Brief summary of your feedback…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</label>
              <Textarea
                placeholder="Describe in detail. For bugs, include steps to reproduce…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>

            {/* Attachments */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Attachments <span className="normal-case font-normal">({attachments.length}/5)</span>
                </label>
                {attachments.length < 5 && (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-xs text-primary font-medium hover:underline disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
                    {uploading ? "Uploading…" : "Add file"}
                  </button>
                )}
              </div>

              {attachments.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {attachments.map((a, i) => {
                    const Icon = fileIcon(a.mimeType)
                    return (
                      <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                        <Icon className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs flex-1 truncate" title={a.fileName}>{a.fileName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatBytes(a.fileSize)}</span>
                        <button
                          onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {attachments.length === 0 && !uploading && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 py-4 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Paperclip className="size-4" />
                  Screenshots, videos, or documents (up to 5 files, 50 MB each)
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf"
                className="hidden"
                onChange={(e) => { void handleFileSelect(e.target.files); e.target.value = "" }}
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={!title.trim() || !description.trim() || submitting || uploading}
              className="w-full mt-1"
            >
              {submitting ? <><Loader2 className="size-4 mr-2 animate-spin" /> Submitting…</> : "Submit Feedback"}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── FeedbackButton ────────────────────────────────────────────────────────────

export function FeedbackButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(true)}
        title="Send feedback"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95 text-sm font-semibold"
      >
        <MessageSquarePlus className="size-4" />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-full max-w-sm rounded-2xl border bg-background shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
          <FeedbackModal onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  )
}
