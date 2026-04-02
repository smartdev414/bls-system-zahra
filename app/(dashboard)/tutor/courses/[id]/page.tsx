"use client"

import { use, useState } from "react"
import Link from "next/link"
import {
  ChevronLeft, Plus, Layers, FileText, PlayCircle,
  FlaskConical, Loader2, ChevronDown, ChevronUp,
  Globe, Lock, Edit3, Trash2, Save,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useFetch, usePostCallback, usePutCallback, useDeleteCallback } from "@/hooks/use-fetch"

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
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  thumbnailUrl: string | null
  sections: SectionItem[]
  _count: { enrollments: number }
}

type CourseData = { course: CourseDetail }

// ─── Type icon map ────────────────────────────────────────────────────────────

const typeIcon = { VIDEO: PlayCircle, TEXT: FileText, QUIZ: FlaskConical }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CourseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, loading, refetch } = useFetch<CourseData>(`/api/tutor/courses/${id}`, {
    errorMessage: "Could not load course",
  })

  // Section dialog state
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [newSectionTitle, setNewSectionTitle] = useState("")

  // Lesson dialog state
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false)
  const [selectedSectionId, setSelectedSectionId] = useState("")
  const [lessonTitle, setLessonTitle] = useState("")
  const [lessonType, setLessonType] = useState<"VIDEO" | "TEXT" | "QUIZ">("VIDEO")
  const [lessonDesc, setLessonDesc] = useState("")
  const [lessonFree, setLessonFree] = useState(false)
  const [assetUrl, setAssetUrl] = useState("")
  const [assetFileName, setAssetFileName] = useState("")

  // Collapsed sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const { execute: createSection, loading: creatingSection } = usePostCallback<{ section: SectionItem }, { title: string }>(
    `/api/tutor/courses/${id}/sections`,
    {
      successMessage: "Section added",
      errorMessage: "Could not add section",
      onSuccess: () => { setSectionDialogOpen(false); setNewSectionTitle(""); refetch() },
    }
  )

  const { execute: createLesson, loading: creatingLesson } = usePostCallback<
    { lesson: LessonItem },
    {
      sectionId: string
      title: string
      type: "VIDEO" | "TEXT" | "QUIZ"
      description?: string
      isFree: boolean
      assets?: Array<{ type: string; title: string; fileUrl: string; fileName: string }>
    }
  >(
    `/api/tutor/courses/${id}/lessons`,
    {
      successMessage: "Lesson added",
      errorMessage: "Could not add lesson",
      onSuccess: () => {
        setLessonDialogOpen(false)
        setLessonTitle(""); setLessonDesc(""); setAssetUrl(""); setAssetFileName("")
        refetch()
      },
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
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) return null

  const { course } = data
  const isPublished = course.status === "PUBLISHED"

  function openLessonDialog(sectionId: string) {
    setSelectedSectionId(sectionId)
    setLessonDialogOpen(true)
  }

  function handleAddLesson() {
    const assets = assetUrl && assetFileName
      ? [{ type: lessonType === "VIDEO" ? "VIDEO" : "DOCUMENT", title: lessonTitle, fileUrl: assetUrl, fileName: assetFileName }]
      : []
    createLesson({ sectionId: selectedSectionId, title: lessonTitle, type: lessonType, description: lessonDesc, isFree: lessonFree, assets })
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
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
            {course.sections.map((section) => {
              const isCollapsed = collapsed[section.id]
              return (
                <Card key={section.id} className="shadow-sm overflow-hidden">
                  {/* Section header */}
                  <button
                    className="w-full flex items-center justify-between px-5 py-3.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-muted-foreground">Section {section.order}</span>
                      <span className="font-semibold text-sm">{section.title}</span>
                      <Badge variant="outline" className="text-[10px]">{section.lessons.length} lessons</Badge>
                    </div>
                    {isCollapsed ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
                  </button>

                  {!isCollapsed && (
                    <>
                      {/* Lesson list */}
                      {section.lessons.map((lesson) => (
                        <LessonRow key={lesson.id} lesson={lesson} onMutated={refetch} />
                      ))}

                      {/* Add lesson button */}
                      <div className="px-5 py-3 border-t">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => openLessonDialog(section.id)}
                        >
                          <Plus className="size-4 mr-1.5" /> Add Lesson
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

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

      {/* Add Lesson Dialog */}
      <Dialog open={lessonDialogOpen} onOpenChange={setLessonDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Lesson</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label>Lesson Title</Label>
                <Input
                  placeholder="e.g. Greetings — Hello and Goodbye"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <Select value={lessonType} onValueChange={(v) => setLessonType(v as typeof lessonType)}>
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
                <Select value={lessonFree ? "free" : "enrolled"} onValueChange={(v) => setLessonFree(v === "free")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enrolled">Enrolled only</SelectItem>
                    <SelectItem value="free">Free preview</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="What will students learn in this lesson?"
                  value={lessonDesc}
                  onChange={(e) => setLessonDesc(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            {/* File URL (simple URL entry — in production this would be an upload component) */}
            {lessonType !== "QUIZ" && (
              <>
                <Separator />
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Add File</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label>File URL</Label>
                    <Input placeholder="https://..." value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <Label>File Name</Label>
                    <Input placeholder="lesson-video.mp4" value={assetFileName} onChange={(e) => setAssetFileName(e.target.value)} />
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLessonDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddLesson}
              disabled={!lessonTitle.trim() || creatingLesson}
            >
              <Save className="size-4 mr-1.5" />
              {creatingLesson ? "Adding..." : "Add Lesson"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Lesson row — owns its own edit/delete hooks ───────────────────────────────

function LessonRow({ lesson, onMutated }: { lesson: LessonItem; onMutated: () => void }) {
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState(lesson.title)
  const [editDesc, setEditDesc] = useState(lesson.description ?? "")
  const [editFree, setEditFree] = useState(lesson.isFree)

  const Icon = typeIcon[lesson.type]

  const { execute: updateLesson, loading: updating } = usePutCallback<
    { lesson: LessonItem },
    { title: string; description: string; isFree: boolean }
  >(`/api/tutor/lessons/${lesson.id}`, {
    successMessage: "Lesson updated",
    errorMessage: "Could not update lesson",
    onSuccess: () => { setEditOpen(false); onMutated() },
  })

  const { execute: deleteLesson, loading: deleting } = useDeleteCallback(
    `/api/tutor/lessons/${lesson.id}`,
    {
      successMessage: "Lesson deleted",
      errorMessage: "Could not delete lesson",
      onSuccess: () => onMutated(),
    }
  )

  return (
    <>
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
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditOpen(true)}>
            <Edit3 className="size-3.5" />
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Lesson</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Visibility</Label>
              <Select value={editFree ? "free" : "enrolled"} onValueChange={(v) => setEditFree(v === "free")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="enrolled">Enrolled only</SelectItem>
                  <SelectItem value="free">Free preview</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => updateLesson({ title: editTitle, description: editDesc, isFree: editFree })}
              disabled={!editTitle.trim() || updating}
            >
              <Save className="size-4 mr-1.5" />
              {updating ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
