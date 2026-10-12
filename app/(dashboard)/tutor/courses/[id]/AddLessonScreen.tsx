"use client"

import { useState } from "react"
import { Save, Upload, Camera, FolderOpen, X } from "lucide-react"
import { toast } from "sonner"
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
import {
  QuizBuilder, blankMultiple, isBlankQuestion, questionProblem, saveQuestionDraft, type QuestionDraft,
} from "@/components/quiz/QuizBuilder"
import { LibraryPicker, itemIcon, formatBytes } from "@/components/library/LibraryPicker"
import type { LibraryAssetType } from "@/lib/library"
import { SignListBuilder } from "@/components/quiz/SignListBuilder"
import { AnswerSecondsField, StoryVideoField, TestKindPicker } from "@/components/quiz/TestKindFields"
import { DEFAULT_ANSWER_SECONDS, isSignTest, type TestKind } from "@/lib/quiz"
import { DEFAULT_TEST_SETTINGS, TestSettingsFields, testSettingsBody, type TestSettingsDraft } from "@/components/quiz/TestSettingsFields"

export type LessonType = "VIDEO" | "TEXT" | "QUIZ"

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
  /** Opened from the library with a file chosen: the kind of lesson to start with. */
  initialType?: LessonType
  /**
   * Files chosen in the library before this screen opened. Attached to a video
   * or text lesson; for a test, a video among them becomes the first question's clip.
   */
  initialFiles?: UploadedFile[]
}

export function AddLessonScreen({ courseId, sectionId, onClose, onSuccess, initialType, initialFiles }: Props) {
  const [title, setTitle] = useState("")
  const [type, setType] = useState<LessonType>(initialType ?? "VIDEO")
  const [desc, setDesc] = useState("")
  const [isFree, setIsFree] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  // Files picked from the resource library, added alongside any fresh upload.
  const [libraryFiles, setLibraryFiles] = useState<UploadedFile[]>(initialFiles ?? [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [videoMode, setVideoMode] = useState<"upload" | "record">("upload")
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => {
    const clip = initialType === "QUIZ" ? initialFiles?.find((f) => f.assetType === "VIDEO") : undefined
    return clip ? [{ ...blankMultiple(), imageUrl: clip.fileUrl, mediaType: "video", dirty: true }] : []
  })
  const [testSettings, setTestSettings] = useState<TestSettingsDraft>(DEFAULT_TEST_SETTINGS)
  const [testKind, setTestKind] = useState<TestKind>("STANDARD")
  const [answerSeconds, setAnswerSeconds] = useState<number>(DEFAULT_ANSWER_SECONDS)
  const [storyUrl, setStoryUrl] = useState<string | null>(null)
  // The signs of a fingerspelling or vocabulary test — kept apart from the
  // questions, so trying another kind does not lose either.
  const [signs, setSigns] = useState<QuestionDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isTest = type === "QUIZ"
  const signTest = isTest && isSignTest(testKind)
  const items = signTest ? signs : questions
  const setItems = signTest ? setSigns : setQuestions
  const itemName = signTest ? "Sign" : "Question"

  async function handleSubmit() {
    if (!title.trim()) return

    // Every question that was started has to be finished — one left half-done
    // would otherwise be dropped without a word. Untouched blanks are ignored.
    const drafts = isTest ? items.filter((q) => !isBlankQuestion(q)) : []
    const unfinished = drafts.filter((q) => questionProblem(q, testKind))
    if (unfinished.length > 0) {
      const ids = new Set(unfinished.map((q) => q.uid))
      setItems((current) => current.map((q) => (
        ids.has(q.uid) ? { ...q, isOpen: true, error: questionProblem(q, testKind) } : q
      )))
      const numbers = items.flatMap((q, i) => (ids.has(q.uid) ? [i + 1] : []))
      setError(
        `${itemName}${numbers.length > 1 ? "s" : ""} ${numbers.join(", ")} ${numbers.length > 1 ? "are" : "is"} not finished. Complete or delete ${numbers.length > 1 ? "them" : "it"}, then add the test.`
      )
      return
    }
    if (isTest && testKind === "STORY" && !storyUrl) {
      setError("Add the story video, then add the test.")
      return
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
        body: JSON.stringify({
          sectionId, title, type, description: desc, isFree, assets,
          ...(isTest && { ...testSettingsBody(testSettings), testKind }),
          ...(signTest && { answerSeconds }),
          ...(isTest && testKind === "STORY" && { storyUrl }),
        }),
      })
      const data = await res.json() as { lesson?: { id: string }; message?: string }
      if (!res.ok) throw new Error(data.message ?? "Could not create lesson")

      const lessonId = data.lesson!.id

      // 2. Save the questions, in order
      let failed = 0
      for (const q of drafts) {
        try {
          await saveQuestionDraft(lessonId, q)
        } catch {
          failed++
        }
      }
      // The test itself exists by now, so this is reported rather than thrown:
      // pressing the button again would create it a second time.
      if (failed > 0) {
        toast.error(
          `The test was added, but ${failed} ${itemName.toLowerCase()}${failed > 1 ? "s" : ""} could not be saved. Open the test to add ${failed > 1 ? "them" : "it"} again.`,
          { duration: 10000 },
        )
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
          <h1 className="text-2xl font-black tracking-tight">{isTest ? "Add Test" : "Add Lesson"}</h1>
          <p className="text-muted-foreground mt-1">
            {isTest ? "Name the test, pick its kind, then add what goes in it." : "Fill in the details for this lesson."}
          </p>
        </div>
        <Button onClick={handleSubmit} disabled={!title.trim() || loading}>
          <Save className="size-4 mr-1.5" />
          {loading ? "Adding..." : isTest ? "Add Test" : "Add Lesson"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label>{isTest ? "Test Title" : "Lesson Title"}</Label>
        <Input
          className="h-11"
          placeholder={isTest ? "e.g. Greetings — end of unit test" : "e.g. Greetings — Hello and Goodbye"}
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
              <SelectItem value="QUIZ">Test</SelectItem>
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


      {isTest && <TestKindPicker value={testKind} onChange={(kind) => { setTestKind(kind); setError(null) }} />}

      {isTest && (
        <TestSettingsFields
          value={testSettings}
          onChange={setTestSettings}
          questionCount={items.filter((q) => !isBlankQuestion(q)).length}
          noun={itemName.toLowerCase()}
        />
      )}

      {signTest && <AnswerSecondsField value={answerSeconds} onChange={setAnswerSeconds} />}

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
          {testKind === "STORY" && (
            <StoryVideoField value={storyUrl} onChange={(url) => { setStoryUrl(url); setError(null) }} />
          )}
          {isSignTest(testKind) ? (
            <SignListBuilder
              kind={testKind}
              lessonId={null}
              signs={signs}
              onChange={(next) => { setSigns(next); setError(null) }}
            />
          ) : (
            <QuizBuilder
              lessonId={null}
              questions={questions}
              onChange={(q) => { setQuestions(q); setError(null) }}
            />
          )}
        </>
      )}
    </div>
  )
}
