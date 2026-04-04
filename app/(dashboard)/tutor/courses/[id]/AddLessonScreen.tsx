"use client"

import { useState } from "react"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload"
import { QuizBuilder, type QuestionDraft } from "@/components/quiz/QuizBuilder"

type LessonType = "VIDEO" | "TEXT" | "QUIZ"

type Props = {
  courseId: string
  sectionId: string
  onClose: () => void
  onSuccess: () => void
}

export function AddLessonScreen({ courseId, sectionId, onClose, onSuccess }: Props) {
  const [title, setTitle] = useState("")
  const [type, setType] = useState<LessonType>("VIDEO")
  const [desc, setDesc] = useState("")
  const [isFree, setIsFree] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const [questions, setQuestions] = useState<QuestionDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  async function handleSubmit() {
    if (!title.trim()) return

    // Warn about incomplete quiz questions
    if (type === "QUIZ" && questions.length > 0) {
      const incomplete = questions.filter(
        (q) => !q.question.trim() || !q.options.some((o) => o.isCorrect) || q.options.some((o) => !o.text?.trim() && !o.imageUrl)
      )
      if (incomplete.length === questions.length) {
        setError("None of your questions are valid. Each question needs text, at least one option marked correct, and all options must have text or an image.")
        return
      }
      if (incomplete.length > 0 && !warning) {
        setWarning(`${incomplete.length} question${incomplete.length > 1 ? "s are" : " is"} incomplete and will be skipped. Click "Add Lesson" again to proceed anyway, or fix the questions first.`)
        return
      }
    }

    setLoading(true)
    setError(null)

    try {
      // 1. Create the lesson
      const assets = uploadedFile
        ? [{
            type: uploadedFile.assetType,
            title,
            fileUrl: uploadedFile.fileUrl,
            fileName: uploadedFile.fileName,
            fileSize: uploadedFile.fileSize,
            mimeType: uploadedFile.mimeType,
          }]
        : []

      const res = await fetch(`/api/tutor/courses/${courseId}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, title, type, description: desc, isFree, assets }),
      })
      const data = await res.json() as { lesson?: { id: string }; message?: string }
      if (!res.ok) throw new Error(data.message ?? "Could not create lesson")

      const lessonId = data.lesson!.id

      // 2. Save quiz questions sequentially
      if (type === "QUIZ" && questions.length > 0) {
        for (const q of questions) {
          if (!q.question.trim()) continue
          if (!q.options.some((o) => o.isCorrect)) continue
          if (q.options.some((o) => !o.text?.trim() && !o.imageUrl)) continue
          await fetch(`/api/tutor/lessons/${lessonId}/questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: q.question,
              imageUrl: q.imageUrl ?? null,
              type: q.type,
              options: q.options.map((o) => ({ text: o.text, imageUrl: o.imageUrl ?? null, mediaType: o.mediaType ?? null, isCorrect: o.isCorrect })),
            }),
          })
        }
      }

      onSuccess()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Add Lesson</h1>
          <p className="text-muted-foreground mt-1">Fill in the details for this lesson.</p>
        </div>
        <Button onClick={handleSubmit} disabled={!title.trim() || loading}>
          <Save className="size-4 mr-1.5" />
          {loading ? "Adding..." : "Add Lesson"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {warning && !error && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{warning}</span>
        </div>
      )}

      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label>Lesson Title</Label>
        <Input
          className="h-11"
          placeholder="e.g. Greetings — Hello and Goodbye"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Type + Visibility */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as LessonType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="VIDEO">Video</SelectItem>
              <SelectItem value="TEXT">Text / Article</SelectItem>
              <SelectItem value="QUIZ">Quiz</SelectItem>
            </SelectContent>
          </Select>
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

      {/* File upload (non-quiz) */}
      {type !== "QUIZ" && (
        <>
          <Separator />
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">File</p>
            <FileUpload
              accept={
                type === "VIDEO"
                  ? "video/mp4,video/webm,video/quicktime"
                  : "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,audio/*"
              }
              label={type === "VIDEO" ? "Upload video" : "Upload file"}
              uploaded={uploadedFile}
              onUploaded={setUploadedFile}
              onRemove={() => setUploadedFile(null)}
            />
          </div>
        </>
      )}

      {/* Quiz builder */}
      {type === "QUIZ" && (
        <>
          <Separator />
          <QuizBuilder
            lessonId={null}
            questions={questions}
            onChange={(q) => { setQuestions(q); setWarning(null) }}
          />
        </>
      )}
    </div>
  )
}
