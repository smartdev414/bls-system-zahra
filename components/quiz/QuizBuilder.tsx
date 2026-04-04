"use client"

import { useState } from "react"
import {
  Plus, Trash2, CheckCircle2, Circle, GripVertical,
  ChevronDown, ChevronUp, Loader2, Save, FlaskConical,
  ImageIcon, X, VideoIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuizOptionDraft = {
  text: string
  imageUrl?: string   // image or video url
  mediaType?: "image" | "video"
  isCorrect: boolean
  uploading?: boolean
}

export type QuestionDraft = {
  id?: string
  question: string
  imageUrl?: string
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
  options: QuizOptionDraft[]
  isOpen: boolean
  isSaving: boolean
  error: string | null
  questionImageUploading?: boolean
}

type Props = {
  lessonId: string | null
  questions: QuestionDraft[]
  onChange: (questions: QuestionDraft[]) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blankMultiple(): QuestionDraft {
  return {
    question: "",
    type: "MULTIPLE_CHOICE",
    options: [
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
    ],
    isOpen: true,
    isSaving: false,
    error: null,
  }
}

function blankTrueFalse(): QuestionDraft {
  return {
    question: "",
    type: "TRUE_FALSE",
    options: [
      { text: "True", isCorrect: true },
      { text: "False", isCorrect: false },
    ],
    isOpen: true,
    isSaving: false,
    error: null,
  }
}

async function uploadImage(file: File): Promise<string> {
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size }),
  })
  if (!presignRes.ok) throw new Error("Could not get upload URL")
  const { presignedUrl, fileUrl } = await presignRes.json() as { presignedUrl: string; fileUrl: string }
  const uploadRes = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
  if (!uploadRes.ok) throw new Error("Upload failed")
  return fileUrl
}

// ─── MediaUploadButton ────────────────────────────────────────────────────────

function MediaUploadButton({
  mediaUrl,
  mediaType,
  uploading,
  onUpload,
  onRemove,
  size = "option",
  acceptVideo = false,
}: {
  mediaUrl?: string
  mediaType?: "image" | "video"
  uploading?: boolean
  onUpload: (file: File) => void
  onRemove: () => void
  size?: "option" | "question"
  acceptVideo?: boolean
}) {
  const accept = acceptVideo
    ? "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
    : "image/jpeg,image/png,image/webp"

  if (mediaUrl) {
    return (
      <div className={cn(
        "relative rounded-lg overflow-hidden border bg-muted group",
        size === "question" ? "w-full max-w-xs aspect-video" : "size-16 shrink-0"
      )}>
        {(mediaType === "video" || /\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(mediaUrl ?? ""))
          ? <video src={mediaUrl} className="w-full h-full object-cover" muted />
          : <img src={mediaUrl} alt="" className="w-full h-full object-cover" />}
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 size-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <label className={cn(
      "flex flex-col items-center justify-center rounded-lg border border-dashed cursor-pointer hover:bg-muted/50 transition-colors text-muted-foreground",
      size === "question" ? "w-full max-w-xs aspect-video gap-1.5" : "size-16 gap-1 shrink-0",
      uploading && "opacity-50 pointer-events-none"
    )}>
      {uploading
        ? <Loader2 className={cn("animate-spin", size === "question" ? "size-6" : "size-4")} />
        : acceptVideo
          ? <VideoIcon className={size === "question" ? "size-6" : "size-4"} />
          : <ImageIcon className={size === "question" ? "size-6" : "size-4"} />}
      {size === "question" && <span className="text-xs">{acceptVideo ? "Add image / video" : "Add image"}</span>}
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = "" }}
      />
    </label>
  )
}

// ─── QuestionCard ─────────────────────────────────────────────────────────────

function QuestionCard({
  q,
  index,
  lessonId,
  onUpdate,
  onDelete,
}: {
  q: QuestionDraft
  index: number
  lessonId: string | null
  onUpdate: (q: QuestionDraft) => void
  onDelete: () => void
}) {
  function setField<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    onUpdate({ ...q, [key]: value })
  }

  function setOption(i: number, patch: Partial<QuizOptionDraft>) {
    const options = q.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o))
    onUpdate({ ...q, options })
  }

  function setCorrect(i: number) {
    const options = q.options.map((o, idx) => ({ ...o, isCorrect: idx === i }))
    onUpdate({ ...q, options })
  }

  function addOption() {
    onUpdate({ ...q, options: [...q.options, { text: "", isCorrect: false }] })
  }

  function removeOption(i: number) {
    if (q.options.length <= 2) return
    onUpdate({ ...q, options: q.options.filter((_, idx) => idx !== i) })
  }

  async function handleQuestionImage(file: File) {
    onUpdate({ ...q, questionImageUploading: true })
    try {
      const url = await uploadImage(file)
      onUpdate({ ...q, imageUrl: url, questionImageUploading: false })
    } catch {
      onUpdate({ ...q, questionImageUploading: false, error: "Image upload failed" })
    }
  }

  async function handleOptionMedia(i: number, file: File) {
    const isVideo = file.type.startsWith("video/")
    setOption(i, { uploading: true })
    try {
      const url = await uploadImage(file)
      const options = q.options.map((o, idx) =>
        idx === i ? { ...o, imageUrl: url, mediaType: isVideo ? "video" as const : "image" as const, uploading: false } : o
      )
      onUpdate({ ...q, options })
    } catch {
      setOption(i, { uploading: false })
      onUpdate({ ...q, error: "Media upload failed" })
    }
  }

  async function saveQuestion() {
    if (!lessonId) return
    if (!q.question.trim()) { onUpdate({ ...q, error: "Question text is required" }); return }
    if (!q.options.some((o) => o.isCorrect)) { onUpdate({ ...q, error: "Mark at least one correct answer" }); return }
    if (q.options.some((o) => !o.text.trim() && !o.imageUrl)) {
      onUpdate({ ...q, error: "Each option needs text or an image" }); return
    }

    onUpdate({ ...q, isSaving: true, error: null })
    try {
      const url = q.id
        ? `/api/tutor/lessons/${lessonId}/questions/${q.id}`
        : `/api/tutor/lessons/${lessonId}/questions`
      const res = await fetch(url, {
        method: q.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.question,
          imageUrl: q.imageUrl ?? null,
          type: q.type,
          options: q.options.map((o) => ({ text: o.text, imageUrl: o.imageUrl ?? null, isCorrect: o.isCorrect })),
        }),
      })
      const data = await res.json() as { question?: { id: string }; message?: string }
      if (!res.ok) throw new Error(data.message ?? "Failed to save")
      onUpdate({ ...q, id: data.question!.id, isSaving: false, isOpen: false, error: null })
    } catch (e) {
      onUpdate({ ...q, isSaving: false, error: e instanceof Error ? e.message : "Failed to save" })
    }
  }

  async function deleteQuestion() {
    if (!lessonId || !q.id) { onDelete(); return }
    onUpdate({ ...q, isSaving: true })
    try { await fetch(`/api/tutor/lessons/${lessonId}/questions/${q.id}`, { method: "DELETE" }) }
    finally { onDelete() }
  }

  const isSaved = !!q.id && !q.isOpen

  return (
    <div className={cn(
      "rounded-xl border bg-background",
      isSaved ? "shadow-none" : "shadow-sm ring-1 ring-primary/20"
    )}>
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <GripVertical className="size-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          {isSaved
            ? <p className="text-sm font-medium truncate">{q.question}</p>
            : <p className="text-xs text-muted-foreground">Question {index + 1}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isSaved && (
            <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="size-3 mr-1" /> Saved
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {q.type === "TRUE_FALSE" ? "True / False" : "Multiple choice"}
          </Badge>
          <Button type="button" variant="ghost" size="icon" className="size-7"
            onClick={() => setField("isOpen", !q.isOpen)}>
            {q.isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
          <Button type="button" variant="ghost" size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={deleteQuestion} disabled={q.isSaving}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {q.isOpen && (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t pt-4">
          {/* Question text */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Question text</Label>
            <Input
              placeholder="e.g. What does this BSL sign mean?"
              value={q.question}
              onChange={(e) => setField("question", e.target.value)}
            />
          </div>

          {/* Optional question image */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              Question image <span className="font-normal">(optional — e.g. a BSL sign to identify)</span>
            </Label>
            <MediaUploadButton
              mediaUrl={q.imageUrl}
              mediaType="image"
              uploading={q.questionImageUploading}
              onUpload={handleQuestionImage}
              onRemove={() => setField("imageUrl", undefined)}
              size="question"
            />
          </div>

          {/* Options */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs">
              {q.type === "TRUE_FALSE" ? "Correct answer" : "Options"}
              {q.type !== "TRUE_FALSE" && (
                <span className="text-muted-foreground font-normal ml-1">
                  — add text and/or an image per option, click ○ to mark correct
                </span>
              )}
            </Label>

            {q.options.map((opt, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 rounded-xl border p-2",
                opt.isCorrect ? "border-emerald-300 bg-emerald-50/50" : "border-border bg-background"
              )}>
                {/* Correct marker */}
                <button type="button" onClick={() => setCorrect(i)} className="shrink-0" title="Mark as correct">
                  {opt.isCorrect
                    ? <CheckCircle2 className="size-5 text-emerald-500" />
                    : <Circle className="size-5 text-muted-foreground" />}
                </button>

                {/* Media slot for option (image or video) */}
                {q.type !== "TRUE_FALSE" && (
                  <MediaUploadButton
                    mediaUrl={opt.imageUrl}
                    mediaType={opt.mediaType}
                    uploading={opt.uploading}
                    onUpload={(f) => handleOptionMedia(i, f)}
                    onRemove={() => setOption(i, { imageUrl: undefined, mediaType: undefined })}
                    size="option"
                    acceptVideo
                  />
                )}

                {/* Text */}
                <Input
                  className="flex-1"
                  placeholder={opt.imageUrl ? "Caption (optional)" : `Option ${i + 1}`}
                  value={opt.text}
                  disabled={q.type === "TRUE_FALSE"}
                  onChange={(e) => setOption(i, { text: e.target.value })}
                />

                {/* Remove option */}
                {q.type === "MULTIPLE_CHOICE" && q.options.length > 2 && (
                  <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0"
                    onClick={() => removeOption(i)}>
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}

            {q.type === "MULTIPLE_CHOICE" && q.options.length < 6 && (
              <Button type="button" variant="outline" size="sm" className="self-start mt-1" onClick={addOption}>
                <Plus className="size-3.5 mr-1" /> Add option
              </Button>
            )}
          </div>

          {q.error && <p className="text-xs text-destructive">{q.error}</p>}

          {lessonId && (
            <Button type="button" size="sm" className="self-start" onClick={saveQuestion} disabled={q.isSaving}>
              {q.isSaving
                ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving…</>
                : <><Save className="size-3.5 mr-1.5" /> {q.id ? "Update" : "Save"} question</>}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── QuizBuilder ──────────────────────────────────────────────────────────────

export function QuizBuilder({ lessonId, questions, onChange }: Props) {
  function add(type: "MULTIPLE_CHOICE" | "TRUE_FALSE") {
    onChange([...questions, type === "TRUE_FALSE" ? blankTrueFalse() : blankMultiple()])
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-primary" />
        <h3 className="font-semibold text-sm">Quiz Questions</h3>
        <Badge variant="outline" className="text-[10px]">
          {questions.length} question{questions.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {questions.length === 0 && (
        <div className="rounded-xl border border-dashed py-10 flex flex-col items-center gap-2 text-center">
          <FlaskConical className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No questions yet. Add your first question below.</p>
        </div>
      )}

      {questions.map((q, i) => (
        <QuestionCard
          key={i}
          q={q}
          index={i}
          lessonId={lessonId}
          onUpdate={(updated) => onChange(questions.map((old, idx) => (idx === i ? updated : old)))}
          onDelete={() => onChange(questions.filter((_, idx) => idx !== i))}
        />
      ))}

      <div className="flex gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" onClick={() => add("MULTIPLE_CHOICE")}>
          <Plus className="size-3.5 mr-1.5" /> Multiple choice
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => add("TRUE_FALSE")}>
          <Plus className="size-3.5 mr-1.5" /> True / False
        </Button>
      </div>

      {!lessonId && questions.length > 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Questions will be saved after you create the lesson.
        </p>
      )}
    </div>
  )
}
