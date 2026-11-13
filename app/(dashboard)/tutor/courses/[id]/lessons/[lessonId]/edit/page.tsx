"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft, Save, Loader2, Trash2, FolderOpen, FlaskConical, Upload, Camera, Link2,
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
import { CameraRecorder } from "@/components/ui/camera-recorder"
import { VideoLinkInput } from "@/components/ui/video-link-input"
import { isVideoLink } from "@/lib/video-link"
import { LibraryPicker } from "@/components/library/LibraryPicker"
import { useCoursesBase } from "@/hooks/use-courses-base"
import { useTestsBase } from "@/hooks/use-tests-base"
import { lessonKind } from "@/lib/lesson-kind"
import { LESSON_FILE_ACCEPT, LESSON_FILE_TYPES } from "../../../AddLessonScreen"
import { ReleaseField, releaseFromIso, releaseToIso } from "@/components/courses/ReleaseField"
import { TEST_KIND_INFO, type TestKind } from "@/lib/quiz"

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
  releaseAt: string | null
  assets: Asset[]
  /** Tests: the bank test this lesson shows — its questions are changed there. */
  test: { id: string; testKind: TestKind; questions: unknown[] } | null
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
  const coursesBase = useCoursesBase()
  const testsBase = useTestsBase()

  const [lesson, setLesson] = useState<LessonFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // form state
  const [title, setTitle] = useState("")
  const [desc, setDesc] = useState("")
  const [isFree, setIsFree] = useState(false)
  const [releaseAt, setReleaseAt] = useState("")
  const [assets, setAssets] = useState<Asset[]>([])
  // Freshly uploaded files, attached on save.
  const [newFiles, setNewFiles] = useState<UploadedFile[]>([])
  // Files picked from the resource library, attached on save like a new upload.
  const [libraryFiles, setLibraryFiles] = useState<UploadedFile[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  // Video lessons can add a file by uploading it or recording it on the camera.
  const [videoMode, setVideoMode] = useState<"upload" | "record" | "link">("upload")

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/tutor/lessons/${lessonId}`)
      .then((r) => r.json())
      .then((d: { lesson: LessonFull; canEdit?: boolean }) => {
        // Teachers follow lessons but don't change them — show the read-only page.
        if (d.canEdit === false) {
          router.replace(`${coursesBase}/${courseId}/lessons/${lessonId}`)
          return
        }
        const l = d.lesson
        setLesson(l)
        setTitle(l.title)
        setDesc(l.description ?? "")
        setIsFree(l.isFree)
        setReleaseAt(releaseFromIso(l.releaseAt))
        setAssets(l.assets)
      })
      .catch(() => setError("Could not load lesson"))
      .finally(() => setLoading(false))
  }, [lessonId, courseId, coursesBase, router])

  // ── Save ──────────────────────────────────────────────────────────────────
  // A test's title, questions and settings belong to the bank test; here only
  // how it sits in this course (visibility, release date) is changed.
  const isTest = lesson?.type === "QUIZ"
  const test = isTest ? lesson?.test ?? null : null

  async function handleSave() {
    if (!title.trim()) return

    setSaving(true)
    setError(null)
    try {
      // 1. Update lesson fields
      const res = await fetch(`/api/tutor/lessons/${lessonId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), description: desc, isFree, releaseAt: releaseToIso(releaseAt),
        }),
      })
      if (!res.ok) {
        const d = await res.json() as { message?: string }
        throw new Error(d.message ?? "Could not save lesson")
      }

      // 2. Add newly uploaded files and any picked from the library as assets
      for (const file of [...newFiles, ...libraryFiles]) {
        const r = await fetch(`/api/tutor/lessons/${lessonId}/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: file.assetType,
            title: file.fileName,
            fileUrl: file.fileUrl,
            fileName: file.fileName,
            fileSize: file.fileSize || undefined,
            mimeType: file.mimeType || undefined,
          }),
        })
        if (!r.ok) throw new Error(`Could not attach ${file.fileName}`)
      }

      router.push(`${coursesBase}/${courseId}`)
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
        <Link href={`${coursesBase}/${courseId}`}>
          <ChevronLeft className="size-4 mr-1" /> Back to Course
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{lesson.type === "QUIZ" ? "Edit Test" : "Edit Lesson"}</h1>
          <p className="text-muted-foreground mt-1">
            {lesson.type === "QUIZ" ? "When students on this course get the test." : "Update the details for this lesson."}
          </p>
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

      {/* Title — a test is named in the Tests menu */}
      {test ? (
        <div className="rounded-xl border bg-muted/20 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold truncate">{title}</p>
            <p className="text-xs text-muted-foreground">
              {TEST_KIND_INFO[test.testKind].label} · {test.questions.length} {test.testKind === "FINGERSPELLING" || test.testKind === "VOCABULARY" ? "sign" : test.testKind === "PRESENTATION" ? "task" : test.testKind === "ASSESSMENT" ? "part" : "question"}{test.questions.length !== 1 ? "s" : ""}.
              {" "}Its questions and pass mark are changed in Tests, for every course that uses it.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`${testsBase}/${test.id}`}><FlaskConical className="size-4 mr-1.5" /> Open test</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>Lesson Title</Label>
          <Input
            className="h-11"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Lesson title"
          />
        </div>
      )}

      {/* Type (read-only) + Visibility */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Input
            value={test
              ? `Test — ${TEST_KIND_INFO[test.testKind].label}`
              : lessonKind(lesson.type, [...assets, ...[...newFiles, ...libraryFiles].map((f) => ({ type: f.assetType }))]).label}
            disabled
          />
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
      {!isTest && (
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <RichTextEditor
            value={desc}
            onChange={setDesc}
            placeholder="What will students learn in this lesson?"
          />
        </div>
      )}

      {/* File management (non-quiz) */}
      {lesson.type !== "QUIZ" && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Files</p>
              <div className="flex flex-wrap items-center gap-1.5">
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
                {lesson.type === "VIDEO" && (
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
                    <Button
                      type="button"
                      size="sm"
                      variant={videoMode === "link" ? "default" : "outline"}
                      className="h-7 text-xs gap-1.5"
                      onClick={() => setVideoMode("link")}
                    >
                      <Link2 className="size-3" />
                      YouTube / Vimeo
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Existing assets */}
            {assets.map((asset) => (
              <div key={asset.id} className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3 overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{asset.fileName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {isVideoLink(asset.fileUrl) ? asset.fileUrl : asset.type.toLowerCase()}
                  </p>
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

            {/* Uploaded, waiting for Save */}
            {newFiles.map((f) => (
              <div key={f.fileUrl} className="flex items-center gap-3 rounded-xl border bg-emerald-50 border-emerald-200 p-3 overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{f.fileName}</p>
                  <p className="text-xs text-emerald-600 truncate">
                    {isVideoLink(f.fileUrl) ? `${f.fileUrl} · Ready to save` : "Ready to save"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => setNewFiles((prev) => prev.filter((x) => x.fileUrl !== f.fileUrl))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            {/* Picked from the library, waiting for Save */}
            {libraryFiles.map((f) => (
              <div key={f.fileUrl} className="flex items-center gap-3 rounded-xl border bg-emerald-50 border-emerald-200 p-3 overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{f.fileName}</p>
                  <p className="text-xs text-emerald-600">From library · Ready to save</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => setLibraryFiles((prev) => prev.filter((x) => x.fileUrl !== f.fileUrl))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            <LibraryPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              allowedTypes={LESSON_FILE_TYPES}
              attachedUrls={[
                ...assets.map((a) => a.fileUrl),
                ...newFiles.map((f) => f.fileUrl),
                ...libraryFiles.map((f) => f.fileUrl),
              ]}
              onPick={(picked) => setLibraryFiles((prev) => [...prev, ...picked])}
            />

            {/* Upload or record new — stays open so several files can be added before saving */}
            {lesson.type === "VIDEO" && videoMode === "link" ? (
              <VideoLinkInput
                onAdded={(f) => {
                  setNewFiles((prev) => (prev.some((x) => x.fileUrl === f.fileUrl) ? prev : [...prev, f]))
                  setVideoMode("upload")
                }}
              />
            ) : lesson.type === "VIDEO" && videoMode === "record" ? (
              <CameraRecorder
                uploaded={null}
                onUploaded={(f) => {
                  setNewFiles((prev) => [...prev, f])
                  setVideoMode("upload")
                }}
              />
            ) : (
            <FileUpload
              accept={LESSON_FILE_ACCEPT}
              label={
                assets.length + newFiles.length + libraryFiles.length > 0
                  ? "Add another file"
                  : lesson.type === "VIDEO" ? "Upload video or file" : "Upload file"
              }
              uploaded={null}
              onUploaded={(f) => setNewFiles((prev) => [...prev, f])}
            />
            )}
          </div>
        </>
      )}

    </div>
  )
}
