"use client"

import { use, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft, Plus, Layers, FileText, PlayCircle,
  FlaskConical, Loader2, ChevronDown, ChevronUp,
  Globe, Lock, Edit3, Trash2, Save, Pencil, X, Camera,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { useFetch, usePostCallback, usePutCallback, usePatchCallback, useDeleteCallback } from "@/hooks/use-fetch"
import { FileUpload } from "@/components/ui/file-upload"
import { Textarea } from "@/components/ui/textarea"
import { COURSE_LEVELS, type CourseLevel } from "@/lib/levels"

// ─── Types ────────────────────────────────────────────────────────────────────

type Asset = {
  id: string
  type: string
  title: string
  fileUrl: string
  fileName: string
  fileSize: number | null
  duration: number | null
}

type LessonItem = {
  id: string
  title: string
  type: "VIDEO" | "TEXT" | "QUIZ"
  description: string | null
  order: number
  isFree: boolean
  assets: Asset[]
}

type SectionItem = {
  id: string
  title: string
  order: number
  lessons: LessonItem[]
}

type CourseDetail = {
  id: string
  title: string
  description: string
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  level: CourseLevel
  thumbnailUrl: string | null
  sections: SectionItem[]
  _count: { enrollments: number }
}

type CourseData = { course: CourseDetail }

const typeIcon = { VIDEO: PlayCircle, TEXT: FileText, QUIZ: FlaskConical }

// ─── Thumbnail editor ─────────────────────────────────────────────────────────

function ThumbnailEditor({
  courseId,
  thumbnailUrl,
  onSaved,
}: {
  courseId: string
  thumbnailUrl: string | null
  onSaved: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(thumbnailUrl)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const uploadRes = await fetch("/api/upload/image", { method: "POST", body: form })
      if (!uploadRes.ok) throw new Error("Could not upload image")
      const { fileUrl } = await uploadRes.json() as { fileUrl: string }

      // Save to course immediately
      const saveRes = await fetch(`/api/tutor/courses/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnailUrl: fileUrl }),
      })
      if (!saveRes.ok) throw new Error("Could not save thumbnail")

      setPreview(fileUrl)
      onSaved(fileUrl)
    } catch {
      // silently revert — upload errors are non-critical
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative w-44 aspect-video rounded-xl overflow-hidden border bg-muted shrink-0 group">
      {preview ? (
        <img src={preview} alt="thumbnail" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
          <Camera className="size-6" />
          <span className="text-[10px] font-medium">No thumbnail</span>
        </div>
      )}

      {/* Hover overlay */}
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="absolute inset-0 bg-black/0 group-hover:bg-black/50 flex flex-col items-center justify-center gap-1 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
      >
        {uploading ? (
          <Loader2 className="size-5 text-white animate-spin" />
        ) : (
          <>
            <Camera className="size-5 text-white" />
            <span className="text-[11px] font-semibold text-white">
              {preview ? "Change" : "Upload"}
            </span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
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

export default function CourseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data, loading, refetch } = useFetch<CourseData>(`/api/tutor/courses/${id}`, {
    errorMessage: "Could not load course",
  })

  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [newSectionTitle, setNewSectionTitle] = useState("")


  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const [editCourseOpen, setEditCourseOpen] = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editLevel, setEditLevel] = useState<CourseLevel>("L1")
  const [editThumbnail, setEditThumbnail] = useState("")

  const { execute: updateCourseInfo, loading: updatingInfo } = usePutCallback<
    { course: CourseDetail },
    { title?: string; description?: string; level?: CourseLevel; thumbnailUrl?: string | null }
  >(`/api/tutor/courses/${id}`, {
    successMessage: "Course updated",
    errorMessage: "Could not update course",
    onSuccess: () => { setEditCourseOpen(false); refetch() },
  })

  const { execute: createSection, loading: creatingSection } = usePostCallback<{ section: SectionItem }, { title: string }>(
    `/api/tutor/courses/${id}/sections`,
    {
      successMessage: "Section added",
      errorMessage: "Could not add section",
      onSuccess: () => { setSectionDialogOpen(false); setNewSectionTitle(""); refetch() },
    }
  )

const { execute: updateCourseStatus, loading: updating } = usePutCallback<
    { course: CourseDetail },
    { status: "DRAFT" | "PUBLISHED" | "ARCHIVED" }
  >(
    `/api/tutor/courses/${id}`,
    {
      successMessage: (d) => `Course ${(d as { course: { status: string } }).course.status.toLowerCase()}`,
      errorMessage: "Could not update course",
      onSuccess: () => refetch(),
    }
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-100">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) return null

  const { course } = data
  const isPublished = course.status === "PUBLISHED"

  function openLessonDialog(sectionId: string) {
    router.push(`/tutor/courses/${id}/lessons/new?sectionId=${sectionId}`)
  }

return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href="/tutor/courses">
          <ChevronLeft className="size-4 mr-1" /> My Courses
        </Link>
      </Button>

      {/* Course header */}
      <div className="flex items-start gap-5">
        <ThumbnailEditor
          courseId={id}
          thumbnailUrl={course.thumbnailUrl}
          onSaved={(url) => {
            // Optimistically update local data — refetch handles the rest
            if (url) refetch()
          }}
        />

        <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge
                variant="outline"
                className={isPublished
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : "bg-amber-100 text-amber-700 border-amber-200"}
              >
                {isPublished ? <Globe className="size-3 mr-1" /> : <Lock className="size-3 mr-1" />}
                {course.status.charAt(0) + course.status.slice(1).toLowerCase()}
              </Badge>
            </div>
            <h1 className="text-2xl font-black truncate">{course.title}</h1>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{course.description}</p>
          </div>

          <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditTitle(course.title)
              setEditDescription(course.description)
              setEditLevel(course.level)
              setEditThumbnail(course.thumbnailUrl ?? "")
              setEditCourseOpen(true)
            }}
          >
            <Pencil className="size-4 mr-1.5" /> Edit Info
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={updating}
            onClick={() => updateCourseStatus({ status: isPublished ? "DRAFT" : "PUBLISHED" })}
          >
            {updating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isPublished ? (
              <><Lock className="size-4 mr-1.5" /> Unpublish</>
            ) : (
              <><Globe className="size-4 mr-1.5" /> Publish</>
            )}
          </Button>
        </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{course._count.enrollments}</span> students enrolled ·
        <span className="font-medium text-foreground">{course.sections.length}</span> sections ·
        <span className="font-medium text-foreground">
          {course.sections.reduce((sum, s) => sum + s.lessons.length, 0)}
        </span> lessons
      </div>

      <Separator />

      {/* Sections & Lessons */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold flex items-center gap-2">
            <Layers className="size-4 text-primary" /> Course Content
          </h2>
          <Button size="sm" variant="outline" onClick={() => setSectionDialogOpen(true)}>
            <Plus className="size-4 mr-1.5" /> Add Section
          </Button>
        </div>

        {course.sections.length === 0 ? (
          <Card className="shadow-sm border-dashed">
            <CardContent className="py-10 text-center">
              <Layers className="size-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No sections yet. Add your first section above.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {course.sections.map((section) => (
              <SectionBlock
                key={section.id}
                courseId={id}
                section={section}
                isCollapsed={!!collapsed[section.id]}
                onToggle={() => setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                onAddLesson={() => openLessonDialog(section.id)}
                onMutated={refetch}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit Course Info Dialog */}
      <Dialog open={editCourseOpen} onOpenChange={setEditCourseOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Course Info</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Course title" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Describe what students will learn"
                rows={4}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Level</Label>
              <Select value={editLevel} onValueChange={(v) => setEditLevel(v as typeof editLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COURSE_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Thumbnail (optional)</Label>
              {editThumbnail ? (
                <div className="relative rounded-xl overflow-hidden aspect-video bg-muted">
                  <img src={editThumbnail} alt="thumbnail" className="w-full h-full object-cover" />
                  <Button
                    type="button" size="icon" variant="destructive"
                    className="absolute top-2 right-2 size-7"
                    onClick={() => setEditThumbnail("")}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <FileUpload
                  accept="image/jpeg,image/png,image/webp"
                  label="Upload thumbnail"
                  uploaded={null}
                  onUploaded={(f) => setEditThumbnail(f.fileUrl)}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCourseOpen(false)}>Cancel</Button>
            <Button
              disabled={!editTitle.trim() || updatingInfo}
              onClick={() => updateCourseInfo({
                title: editTitle.trim(),
                description: editDescription.trim(),
                level: editLevel,
                thumbnailUrl: editThumbnail || null,
              })}
            >
              <Save className="size-4 mr-1.5" />
              {updatingInfo ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Section Dialog */}
      <Dialog open={sectionDialogOpen} onOpenChange={setSectionDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Section</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>Section Title</Label>
              <Input
                placeholder="e.g. Introduction to BSL"
                value={newSectionTitle}
                onChange={(e) => setNewSectionTitle(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createSection({ title: newSectionTitle })}
              disabled={!newSectionTitle.trim() || creatingSection}
            >
              {creatingSection ? "Adding..." : "Add Section"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

// ─── Section block — owns its own delete hook ────────────────────────────────

function SectionBlock({
  courseId,
  section,
  isCollapsed,
  onToggle,
  onAddLesson,
  onMutated,
}: {
  courseId: string
  section: SectionItem
  isCollapsed: boolean
  onToggle: () => void
  onAddLesson: () => void
  onMutated: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(section.title)

  const { execute: renameSection, loading: renamingLoading } = usePatchCallback<
    { section: SectionItem },
    { title: string }
  >(`/api/tutor/courses/${courseId}/sections/${section.id}`, {
    successMessage: "Section renamed",
    errorMessage: "Could not rename section",
    onSuccess: () => { setRenaming(false); onMutated() },
  })

  const { execute: deleteSection, loading: deleting } = useDeleteCallback(
    `/api/tutor/courses/${courseId}/sections/${section.id}`,
    {
      successMessage: "Section deleted",
      errorMessage: "Could not delete section",
      onSuccess: () => onMutated(),
    }
  )

  return (
    <Card className="shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="flex items-center bg-muted/30 hover:bg-muted/50 transition-colors">
        {renaming ? (
          <div className="flex-1 flex items-center gap-2 px-5 py-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) renameSection({ title: renameValue })
                if (e.key === "Escape") { setRenaming(false); setRenameValue(section.title) }
              }}
            />
            <Button
              size="icon" variant="ghost" className="size-8 text-emerald-600 shrink-0"
              disabled={renamingLoading || !renameValue.trim()}
              onClick={() => renameSection({ title: renameValue })}
            >
              {renamingLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Edit3 className="size-3.5" />}
            </Button>
            <Button
              size="icon" variant="ghost" className="size-8 shrink-0"
              onClick={() => { setRenaming(false); setRenameValue(section.title) }}
            >
              <ChevronUp className="size-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <button
              className="flex-1 flex items-center gap-3 px-5 py-3.5 text-left"
              onClick={onToggle}
            >
              <span className="text-xs font-bold text-muted-foreground">Section {section.order}</span>
              <span className="font-semibold text-sm">{section.title}</span>
              <Badge variant="outline" className="text-[10px]">{section.lessons.length} lessons</Badge>
              {isCollapsed ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
            </button>
            <div className="flex items-center gap-0.5 pr-2">
              <Button
                variant="ghost" size="icon" className="size-7"
                onClick={() => { setRenameValue(section.title); setRenaming(true) }}
                title="Rename"
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="size-7 text-destructive hover:text-destructive"
                disabled={deleting || section.lessons.length > 0}
                title={section.lessons.length > 0 ? "Remove lessons first" : "Delete section"}
                onClick={() => deleteSection()}
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3" />}
              </Button>
            </div>
          </>
        )}
      </div>

      {!isCollapsed && !renaming && (
        <>
          {section.lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} courseId={courseId} onMutated={onMutated} />
          ))}
          <div className="px-5 py-3 border-t">
            <Button
              variant="ghost" size="sm" className="text-primary hover:text-primary"
              onClick={onAddLesson}
            >
              <Plus className="size-4 mr-1.5" /> Add Lesson
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

// ─── Lesson row — edit navigates to dedicated page ────────────────────────────

function LessonRow({ lesson, courseId, onMutated }: { lesson: LessonItem; courseId: string; onMutated: () => void }) {
  const Icon = typeIcon[lesson.type]

  const { execute: deleteLesson, loading: deleting } = useDeleteCallback(
    `/api/tutor/lessons/${lesson.id}`,
    {
      successMessage: "Lesson deleted",
      errorMessage: "Could not delete lesson",
      onSuccess: () => onMutated(),
    }
  )

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-t hover:bg-muted/20 transition-colors">
      <div className="rounded-lg bg-primary/10 p-1.5 shrink-0">
        <Icon className="size-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{lesson.order}. {lesson.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{lesson.type.charAt(0) + lesson.type.slice(1).toLowerCase()}</span>
          {lesson.isFree && <Badge variant="outline" className="text-[10px] h-4 px-1">Free</Badge>}
          {lesson.assets.length > 0 && <span>· {lesson.assets.length} file{lesson.assets.length !== 1 ? "s" : ""}</span>}
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button asChild variant="ghost" size="icon" className="size-7">
          <Link href={`/tutor/courses/${courseId}/lessons/${lesson.id}/edit`}>
            <Edit3 className="size-3.5" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => deleteLesson()}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
