"use client"

import { useState } from "react"
import { Save, Upload, Camera, FolderOpen, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload"
import { CameraRecorder } from "@/components/ui/camera-recorder"
import { QuizBuilder, type QuestionDraft } from "@/components/quiz/QuizBuilder"
import { LibraryPicker, itemIcon, formatBytes } from "@/components/library/LibraryPicker"
import type { LibraryAssetType } from "@/lib/library"
import { ReleaseField, releaseToIso } from "@/components/courses/ReleaseField"

type LessonType = "VIDEO" | "TEXT" | "QUIZ"

/** What a video or text lesson can hold — matches the upload box's `accept`. */
export const LESSON_FILE_TYPES: readonly LibraryAssetType[] = ["VIDEO", "PDF", "DOCUMENT", "IMAGE", "AUDIO"]

export const LESSON_FILE_ACCEPT =
  "video/mp4,video/webm,video/quicktime,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  ".doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*,audio/mpeg,audio/wav"

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
  const [releaseAt, setReleaseAt] = useState("")
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  // Files picked from the resource library, added alongside any fresh upload.
  const [libraryFiles, setLibraryFiles] = useState<UploadedFile[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [videoMode, setVideoMode] = useState<"upload" | "record">("upload")
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
      // A file picked before switching to a quiz is not something a quiz can show.
      const files = type === "QUIZ" ? [] : [
        ...(uploadedFile ? [uploadedFile] : []),
        ...libraryFiles,
      ]
      const assets = files.map((f) => ({
        type: f.assetType,
        // The main upload keeps the lesson title, as before; picked files keep their own name.
        title: f === uploadedFile ? title : f.fileName,
        fileUrl: f.fileUrl,
        fileName: f.fileName,
        fileSize: f.fileSize || undefined,
        mimeType: f.mimeType || undefined,
      }))

      const res = await fetch(`/api/tutor/courses/${courseId}/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, title, type, description: desc, isFree, releaseAt: releaseToIso(releaseAt), assets }),
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

      <ReleaseField value={releaseAt} onChange={setReleaseAt} />

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
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">File</p>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setPickerOpen(true)}
                >
                  <FolderOpen className="size-3" />
                  Choose from library
                </Button>
              {type === "VIDEO" && !uploadedFile && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant={videoMode === "upload" ? "default" : "outline"}
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setVideoMode("upload")}
                  >
                    <Upload className="size-3" />
                    Upload
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={videoMode === "record" ? "default" : "outline"}
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setVideoMode("record")}
                  >
                    <Camera className="size-3" />
                    Record
                  </Button>
                </>
              )}
              </div>
            </div>

            {/* Picked from the library */}
            {libraryFiles.map((f) => {
                const Icon = itemIcon(f.assetType)
                return (
                  <div key={f.fileUrl} className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3 overflow-hidden">
                    <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                      <Icon className="size-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" title={f.fileName}>{f.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {[formatBytes(f.fileSize), "From library"].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      onClick={() => setLibraryFiles((prev) => prev.filter((x) => x.fileUrl !== f.fileUrl))}
                      aria-label={`Remove ${f.fileName}`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                )
              })}

            <LibraryPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              allowedTypes={LESSON_FILE_TYPES}
              attachedUrls={[
                ...(uploadedFile ? [uploadedFile.fileUrl] : []),
                ...libraryFiles.map((f) => f.fileUrl),
              ]}
              onPick={(picked) => setLibraryFiles((prev) => [...prev, ...picked])}
            />
            {type === "VIDEO" && videoMode === "record" ? (
              <CameraRecorder
                uploaded={uploadedFile}
                onUploaded={setUploadedFile}
                onRemove={() => setUploadedFile(null)}
              />
            ) : (
              <FileUpload
                accept={LESSON_FILE_ACCEPT}
                label={type === "VIDEO" ? "Upload video or file" : "Upload file"}
                uploaded={uploadedFile}
                onUploaded={setUploadedFile}
                onRemove={() => setUploadedFile(null)}
              />
            )}
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
