"use client"

import { use, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft, Plus, Layers,
  Loader2, ChevronDown, ChevronUp,
  Globe, Lock, Edit3, Trash2, Save, Pencil, X, Camera, Eye, GraduationCap, Copy, CalendarClock,
  ArrowUp, ArrowDown,
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
import { useCoursesBase } from "@/hooks/use-courses-base"
import { Textarea } from "@/components/ui/textarea"
import { COURSE_LEVELS, type CourseLevel } from "@/lib/levels"
import { CourseGroups } from "@/components/courses/CourseGroups"
import { CopyCourseDialog } from "@/components/courses/CopyCourseDialog"
import { ReleaseBadge } from "@/components/courses/ReleaseField"
import { lessonKind } from "@/lib/lesson-kind"
import { ReleaseScheduleDialog } from "@/components/courses/ReleaseScheduleDialog"
import { VideoCleanBadge } from "@/components/ui/video-clean-badge"

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
  // Set while the lesson is being held back from students.
  releaseAt: string | null
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
  // The lead, and the teachers the school has put on the course.
  tutor: { id: string; name: string }
  teachers: Array<{ id: string; name: string }>
  _count: { enrollments: number }
}

// `canEdit` is false for teachers: they follow the course, admins build it.
type CourseData = { course: CourseDetail; canEdit: boolean }

/** The one date every lesson in a section shares, when they all share one. */
function sharedRelease(section: SectionItem): string | null {
  const first = section.lessons[0]?.releaseAt ?? null
  return first && section.lessons.every((l) => l.releaseAt === first) ? first : null
}

/** One line on how the course reaches students. */
function releaseSummary(sections: SectionItem[]): string {
  const upcoming = sections
    .flatMap((s) => s.lessons.flatMap((l) => (l.releaseAt ? [{ title: s.title, at: new Date(l.releaseAt) }] : [])))
    .filter((x) => x.at > new Date())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  if (upcoming.length === 0) return "Everything is available to students now."
  const next = upcoming[0]
  return `Released in stages — next: ${next.title} on ${next.at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}.`
}

// ─── Thumbnail editor ─────────────────────────────────────────────────────────

function ThumbnailEditor({
  courseId,
  thumbnailUrl,
  onSaved,
  readOnly = false,
}: {
  courseId: string
  thumbnailUrl: string | null
  onSaved: (url: string | null) => void
  readOnly?: boolean
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
    <div className="relative w-full sm:w-44 aspect-video rounded-xl overflow-hidden border bg-muted sm:shrink-0 group">
      {preview ? (
        <img src={preview} alt="thumbnail" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
          <Camera className="size-6" />
          <span className="text-[10px] font-medium">No thumbnail</span>
        </div>
      )}

      {/* Hover overlay */}
      {!readOnly && <button
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
      </button>}

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
  const coursesBase = useCoursesBase()
  const { data, loading, refetch, mutate } = useFetch<CourseData>(`/api/tutor/courses/${id}`, {
    errorMessage: "Could not load course",
  })

  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [newSectionTitle, setNewSectionTitle] = useState("")


  // Which sections are closed. Remembered per course on this device, because
  // adding a lesson leaves this page and a reload remounts it — either would
  // otherwise reopen every section the teacher had closed.
  const collapsedKey = `course:collapsedSections:${id}`
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {}
    try {
      const ids: unknown = JSON.parse(window.localStorage.getItem(collapsedKey) ?? "[]")
      return Array.isArray(ids) ? Object.fromEntries(ids.map((sectionId) => [String(sectionId), true])) : {}
    } catch {
      return {}
    }
  })

  function toggleSection(sectionId: string) {
    const next = { ...collapsed, [sectionId]: !collapsed[sectionId] }
    setCollapsed(next)
    try {
      window.localStorage.setItem(collapsedKey, JSON.stringify(Object.keys(next).filter((k) => next[k])))
    } catch { /* ignore */ }
  }

  const [editCourseOpen, setEditCourseOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
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

  const { course, canEdit } = data
  const isPublished = course.status === "PUBLISHED"
  const teacherNames = [course.tutor, ...course.teachers]
    .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
    .map((t) => t.name)

  function openLessonDialog(sectionId: string) {
    router.push(`${coursesBase}/${id}/lessons/new?sectionId=${sectionId}`)
  }

return (
    // From xl the groups sit in their own column on the right, beside the
    // course header and its content; below that everything stacks in one column.
    <div className="grid gap-6 max-w-4xl xl:max-w-none xl:grid-cols-[minmax(0,1fr)_28rem] xl:grid-rows-[auto_1fr] xl:gap-x-8 xl:items-start">
      <div className="flex flex-col gap-6 min-w-0">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href={coursesBase}>
          <ChevronLeft className="size-4 mr-1" /> {coursesBase === "/admin/courses" ? "All Courses" : "My Courses"}
        </Link>
      </Button>

      {/* Course header — thumb stacks above the title block on phones, sits
          beside it from sm+. The title row itself also stacks on phones so the
          action buttons drop below the long title instead of crowding it. */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-5">
        <ThumbnailEditor
          courseId={id}
          thumbnailUrl={course.thumbnailUrl}
          readOnly={!canEdit}
          onSaved={(url) => {
            // Optimistically update local data — refetch handles the rest
            if (url) refetch()
          }}
        />

        <div className="flex-1 min-w-0 flex flex-col md:flex-row md:items-start md:justify-between xl:flex-col xl:justify-start gap-3 md:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
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
            <h1 className="text-xl sm:text-2xl font-black break-words">{course.title}</h1>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-3 sm:line-clamp-2">{course.description}</p>
          </div>

          {canEdit && <div className="flex flex-wrap gap-2 md:shrink-0">
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
          <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}>
            <Copy className="size-4 mr-1.5" /> Copy Course
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
        </div>}
        </div>
      </div>

      {/* Stats — flex-wrap so the inline `·` separators wrap cleanly on phones. */}
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span><span className="font-medium text-foreground">{course._count.enrollments}</span> student{course._count.enrollments === 1 ? "" : "s"} enrolled</span>
        <span aria-hidden>·</span>
        <span><span className="font-medium text-foreground">{course.sections.length}</span> section{course.sections.length === 1 ? "" : "s"}</span>
        <span aria-hidden>·</span>
        <span>
          <span className="font-medium text-foreground">
            {course.sections.reduce((sum, s) => sum + s.lessons.length, 0)}
          </span> lessons
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <GraduationCap className="size-3.5" />
          {teacherNames.join(", ")}
        </span>
      </div>

      {!canEdit && (
        <p className="text-sm text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
          This course is set up by the school, so its lessons are view-only for you. You can still manage its groups, students and class times.
        </p>
      )}

      </div>

      {/* Groups — stays in view while the lessons scroll past. */}
      <div className="flex flex-col gap-6 min-w-0 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
        <Separator className="xl:hidden" />
        <CourseGroups
          courseId={id}
          courseTitle={course.title}
          onTotalChange={(total) =>
            mutate((prev) => prev && { ...prev, course: { ...prev.course, _count: { enrollments: total } } })
          }
        />
      </div>

      {/* Sections & Lessons */}
      <div className="flex flex-col gap-6 min-w-0">
        <Separator />
        <div>
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="font-bold flex items-center gap-2">
              <Layers className="size-4 text-primary" /> Course Content
            </h2>
            {course.sections.length > 0 && (
              <p className="text-sm text-muted-foreground mt-0.5">{releaseSummary(course.sections)}</p>
            )}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {course.sections.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setReleaseOpen(true)}>
                  <CalendarClock className="size-4 mr-1.5" /> Release Schedule
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setSectionDialogOpen(true)}>
                <Plus className="size-4 mr-1.5" /> Add Section
              </Button>
            </div>
          )}
        </div>

        {course.sections.length === 0 ? (
          <Card className="shadow-sm border-dashed">
            <CardContent className="py-10 text-center">
              <Layers className="size-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {canEdit ? "No sections yet. Add your first section above." : "No lessons have been added to this course yet."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {course.sections.map((section) => (
              <SectionBlock
                key={section.id}
                courseId={id}
                section={section}
                canEdit={canEdit}
                isCollapsed={!!collapsed[section.id]}
                onToggle={() => toggleSection(section.id)}
                onAddLesson={() => openLessonDialog(section.id)}
                onReorder={(lessons) =>
                  // Swapped in place: a refetch would blank the page for a moment.
                  mutate((prev) => prev && {
                    ...prev,
                    course: {
                      ...prev.course,
                      sections: prev.course.sections.map((s) => (s.id === section.id ? { ...s, lessons } : s)),
                    },
                  })
                }
                onMutated={refetch}
              />
            ))}
          </div>
        )}
        </div>
      </div>

      {releaseOpen && (
        <ReleaseScheduleDialog
          courseId={id}
          sections={course.sections}
          onClose={() => setReleaseOpen(false)}
          onSaved={refetch}
        />
      )}

      {copyOpen && (
        <CopyCourseDialog
          course={{ id, title: course.title }}
          onClose={() => setCopyOpen(false)}
          onCopied={(newId) => { setCopyOpen(false); router.push(`${coursesBase}/${newId}`) }}
        />
      )}

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
  canEdit,
  isCollapsed,
  onToggle,
  onAddLesson,
  onReorder,
  onMutated,
}: {
  courseId: string
  section: SectionItem
  canEdit: boolean
  isCollapsed: boolean
  onToggle: () => void
  onAddLesson: () => void
  /** The section's lessons in their new order, shown before the save lands. */
  onReorder: (lessons: LessonItem[]) => void
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

  const { execute: saveOrder, loading: reordering } = usePutCallback<{ ok: true }, { lessonIds: string[] }>(
    `/api/tutor/courses/${courseId}/sections/${section.id}/reorder`,
    {
      successMessage: false,
      errorMessage: "Could not move lesson",
      // Put the list back the way the server has it.
      onError: () => onMutated(),
    }
  )

  function moveLesson(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= section.lessons.length) return
    const next = [...section.lessons]
    ;[next[index], next[target]] = [next[target], next[index]]
    onReorder(next.map((l, i) => ({ ...l, order: i + 1 })))
    saveOrder({ lessonIds: next.map((l) => l.id) })
  }

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
              className="flex-1 min-w-0 flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3.5 text-left"
              onClick={onToggle}
            >
              <span className="text-xs font-bold text-muted-foreground shrink-0">Section {section.order}</span>
              <span className="font-semibold text-sm truncate">{section.title}</span>
              <Badge variant="outline" className="text-[10px] shrink-0 hidden sm:inline-flex">{section.lessons.length} lesson{section.lessons.length === 1 ? "" : "s"}</Badge>
              <Badge variant="outline" className="text-[10px] shrink-0 sm:hidden">{section.lessons.length}</Badge>
              {/* One date for the section, shown once rather than on every lesson. */}
              <ReleaseBadge releaseAt={sharedRelease(section)} className="text-[10px] shrink-0 hidden sm:inline-flex" />
              {isCollapsed ? <ChevronDown className="size-4 text-muted-foreground shrink-0 ml-auto" /> : <ChevronUp className="size-4 text-muted-foreground shrink-0 ml-auto" />}
            </button>
            {canEdit && <div className="flex items-center gap-0.5 pr-1 sm:pr-2 shrink-0">
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
            </div>}
          </>
        )}
      </div>

      {!isCollapsed && !renaming && (
        <>
          {section.lessons.map((lesson, index) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              courseId={courseId}
              canEdit={canEdit}
              hideRelease={sharedRelease(section) !== null}
              onMoveUp={index > 0 ? () => moveLesson(index, -1) : undefined}
              onMoveDown={index < section.lessons.length - 1 ? () => moveLesson(index, 1) : undefined}
              moving={reordering}
              onMutated={onMutated}
            />
          ))}
          {canEdit ? (
            <div className="px-3 sm:px-5 py-3 border-t">
              <Button
                variant="ghost" size="sm" className="text-primary hover:text-primary"
                onClick={onAddLesson}
              >
                <Plus className="size-4 mr-1.5" /> Add Lesson
              </Button>
            </div>
          ) : section.lessons.length === 0 ? (
            <p className="px-3 sm:px-5 py-3 border-t text-xs text-muted-foreground">No lessons in this section yet.</p>
          ) : null}
        </>
      )}
    </Card>
  )
}

// ─── Lesson row — edit (admins) or view (teachers) on a dedicated page ────────

function LessonRow({ lesson, courseId, canEdit, hideRelease, onMoveUp, onMoveDown, moving, onMutated }: {
  lesson: LessonItem
  courseId: string
  canEdit: boolean
  /** The section header already shows the date this lesson shares with the rest. */
  hideRelease: boolean
  /** Swap with the lesson above / below; undefined at the ends of the section. */
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** A move is still saving, so another would race it. */
  moving: boolean
  onMutated: () => void
}) {
  const { label, Icon } = lessonKind(lesson.type, lesson.assets)
  const coursesBase = useCoursesBase()

  const { execute: deleteLesson, loading: deleting } = useDeleteCallback(
    `/api/tutor/lessons/${lesson.id}`,
    {
      successMessage: "Lesson deleted",
      errorMessage: "Could not delete lesson",
      onSuccess: () => onMutated(),
    }
  )

  return (
    <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 border-t hover:bg-muted/20 transition-colors">
      <div className="rounded-lg bg-primary/10 p-1.5 shrink-0">
        <Icon className="size-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{lesson.order}. {lesson.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{label}</span>
          {lesson.isFree && <Badge variant="outline" className="text-[10px] h-4 px-1">Free</Badge>}
          {!hideRelease && <ReleaseBadge releaseAt={lesson.releaseAt} className="text-[10px] h-4 px-1" />}
          {lesson.assets.length > 0 && <span>· {lesson.assets.length} file{lesson.assets.length !== 1 ? "s" : ""}</span>}
          {lesson.assets.map((asset) => <VideoCleanBadge key={asset.id} url={asset.fileUrl} />)}
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
          <Link href={`${coursesBase}/${courseId}/lessons/${lesson.id}`}>
            <Eye className="size-3.5" /> View
          </Link>
        </Button>
        {canEdit && (
          <>
            <Button
              variant="ghost" size="icon" className="size-7"
              disabled={!onMoveUp || moving}
              title="Move up"
              onClick={onMoveUp}
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="size-7"
              disabled={!onMoveDown || moving}
              title="Move down"
              onClick={onMoveDown}
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Button asChild variant="ghost" size="icon" className="size-7">
              <Link href={`${coursesBase}/${courseId}/lessons/${lesson.id}/edit`}>
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
          </>
        )}
      </div>
    </div>
  )
}
