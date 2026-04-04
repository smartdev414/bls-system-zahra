"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft, Save, Loader2, Plus, Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload"
import { QuizBuilder, type QuestionDraft } from "@/components/quiz/QuizBuilder"

// ─── Types ────────────────────────────────────────────────────────────────────

type Asset = {
  id: string
  type: string
  title: string
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string
}

type LessonFull = {
  id: string
  title: string
  type: "VIDEO" | "TEXT" | "QUIZ"
  description: string | null
  isFree: boolean
  assets: Asset[]
  questions: Array<{
    id: string
    question: string
    imageUrl: string | null
    type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
    options: Array<{
      id: string
      text: string
      imageUrl: string | null
      mediaType: string | null
      isCorrect: boolean
      order: number
    }>
  }>
  section: { courseId: string }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EditLessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>
}) {
  const { id: courseId, lessonId } = use(params)
  const router = useRouter()

  const [lesson, setLesson] = useState<LessonFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // form state
  const [title, setTitle] = useState("")
  const [desc, setDesc] = useState("")
  const [isFree, setIsFree] = useState(false)
  const [assets, setAssets] = useState<Asset[]>([])
  const [newFile, setNewFile] = useState<UploadedFile | null>(null)
  const [questions, setQuestions] = useState<QuestionDraft[]>([])

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/tutor/lessons/${lessonId}`)
      .then((r) => r.json())
      .then((d: { lesson: LessonFull }) => {
        const l = d.lesson
        setLesson(l)
        setTitle(l.title)
        setDesc(l.description ?? "")
        setIsFree(l.isFree)
        setAssets(l.assets)
        setQuestions(
          l.questions.map((q) => ({
            id: q.id,
            question: q.question,
            imageUrl: q.imageUrl ?? undefined,
            type: q.type,
            options: q.options.map((o) => ({
              text: o.text,
              imageUrl: o.imageUrl ?? undefined,
              mediaType: o.mediaType as "image" | "video" | undefined,
              isCorrect: o.isCorrect,
            })),
            isOpen: false,
            isSaving: false,
            error: null,
          }))
        )
      })
      .catch(() => setError("Could not load lesson"))
      .finally(() => setLoading(false))
  }, [lessonId])

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!title.trim()) return

    // Warn about unsaved quiz questions
    if (lesson?.type === "QUIZ") {
      const unsavedNew = questions.filter((q) => !q.id)
      const unsavedEdits = questions.filter((q) => q.id && q.isOpen)
      if (unsavedNew.length > 0) {
        setError(
          `${unsavedNew.length} question${unsavedNew.length > 1 ? "s have" : " has"} not been saved yet. Use the "Save question" button on each question before saving the lesson.`
        )
        return
      }
      if (unsavedEdits.length > 0) {
        setError(
          `${unsavedEdits.length} question${unsavedEdits.length > 1 ? "s have" : " has"} unsaved edits. Use the "Update question" button on each open question before saving the lesson.`
        )
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      // 1. Update lesson fields
      const res = await fetch(`/api/tutor/lessons/${lessonId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: desc, isFree }),
      })
      if (!res.ok) {
        const d = await res.json() as { message?: string }
        throw new Error(d.message ?? "Could not save lesson")
      }

      // 2. If a new file was uploaded, add it as an asset
      if (newFile) {
        await fetch(`/api/tutor/lessons/${lessonId}/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: newFile.assetType,
            title: newFile.fileName,
            fileUrl: newFile.fileUrl,
            fileName: newFile.fileName,
            fileSize: newFile.fileSize,
            mimeType: newFile.mimeType,
          }),
        })
      }

      router.push(`/tutor/courses/${courseId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function removeAsset(assetId: string) {
    await fetch(`/api/tutor/lessons/${lessonId}/assets/${assetId}`, { method: "DELETE" })
    setAssets((a) => a.filter((x) => x.id !== assetId))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-75">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!lesson) {
    return (
      <div className="text-center py-16 text-muted-foreground">Lesson not found.</div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href={`/tutor/courses/${courseId}`}>
          <ChevronLeft className="size-4 mr-1" /> Back to Course
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Edit Lesson</h1>
          <p className="text-muted-foreground mt-1">Update the details for this lesson.</p>
        </div>
        <Button onClick={handleSave} disabled={!title.trim() || saving}>
          <Save className="size-4 mr-1.5" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label>Lesson Title</Label>
        <Input
          className="h-11"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
        />
      </div>

      {/* Type (read-only) + Visibility */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Input value={lesson.type.charAt(0) + lesson.type.slice(1).toLowerCase()} disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Visibility</Label>
          <Select value={isFree ? "free" : "enrolled"} onValueChange={(v) => setIsFree(v === "free")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="enrolled">Enrolled only</SelectItem>
              <SelectItem value="free">Free preview</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <Label>Description</Label>
        <RichTextEditor
          value={desc}
          onChange={setDesc}
          placeholder="What will students learn in this lesson?"
        />
      </div>

      {/* File management (non-quiz) */}
      {lesson.type !== "QUIZ" && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Files</p>

            {/* Existing assets */}
            {assets.map((asset) => (
              <div key={asset.id} className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3 overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{asset.fileName}</p>
                  <p className="text-xs text-muted-foreground">{asset.type.toLowerCase()}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => removeAsset(asset.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            {/* Upload new */}
            {!newFile && (
              <FileUpload
                accept={
                  lesson.type === "VIDEO"
                    ? "video/mp4,video/webm,video/quicktime"
                    : "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,audio/*"
                }
                label={assets.length > 0 ? "Add another file" : lesson.type === "VIDEO" ? "Upload video" : "Upload file"}
                uploaded={null}
                onUploaded={setNewFile}
              />
            )}

            {newFile && (
              <div className="flex items-center gap-3 rounded-xl border bg-emerald-50 border-emerald-200 p-3 overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{newFile.fileName}</p>
                  <p className="text-xs text-emerald-600">Ready to save</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => setNewFile(null)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Quiz builder */}
      {lesson.type === "QUIZ" && (
        <>
          <Separator />
          <QuizBuilder
            lessonId={lessonId}
            questions={questions}
            onChange={(q) => { setQuestions(q); setError(null) }}
          />
        </>
      )}
    </div>
  )
}
