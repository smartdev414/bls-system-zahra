"use client"

import { useRouter } from "next/navigation"
import { SafeHtml } from "@/components/ui/safe-html"
import { use, useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2, ChevronLeft, ChevronRight, PlayCircle,
  FileText, FlaskConical, Download, BookOpen,
  Loader2, CheckCheck, List, X, User, Lock, CalendarClock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { useFetch, usePatchCallback } from "@/hooks/use-fetch"
import { releaseLabel } from "@/lib/lesson-release"
import { QuizTaker } from "@/components/quiz/QuizTaker"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Asset = {
  id: string
  type: "VIDEO" | "PDF" | "IMAGE" | "DOCUMENT" | "AUDIO" | "SUBTITLE"
  title: string
  description: string | null
  fileUrl: string
  fileName: string
  fileSize: number | null
  duration: number | null
  mimeType: string | null
  order: number
}

type LessonNav = { id: string; title: string; sectionId: string; locked: boolean; releaseAt: string | null } | null

/** What the API answers for a lesson that has not been released yet. */
type LockedLesson = { locked: true; releaseAt: string; courseId: string }

type SectionLesson = {
  id: string
  title: string
  type: string
  order: number
  isFree: boolean
  isCompleted: boolean
  isCurrent: boolean
  locked: boolean
  releaseAt: string | null
}

type SectionItem = {
  id: string
  title: string
  order: number
  lessons: SectionLesson[]
}

type LessonData = {
  lesson: {
    id: string
    title: string
    type: "VIDEO" | "TEXT" | "QUIZ"
    description: string | null
    isFree: boolean
    assets: Asset[]
    /** A video exists but is still being prepared, so it isn't in `assets` yet. */
    videoPending?: boolean
    isCompleted: boolean
    watchedSecs: number
  }
  course: {
    id: string
    title: string
    tutor: { id: string; name: string; avatarUrl: string | null; tutorProfile: { bio: string | null; qualifications: string[] } | null }
  }
  section: { id: string; title: string }
  navigation: { prev: LessonNav; next: LessonNav; currentIndex: number; total: number }
  progress: { completedLessons: number; totalLessons: number; completion: number }
  sections: SectionItem[]
  enrollmentId: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

const typeIcon = { VIDEO: PlayCircle, TEXT: FileText, QUIZ: FlaskConical }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LessonViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  // Closed to begin with on a phone, where it would cover most of the lesson.
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768)
  const [isCompleted, setIsCompleted] = useState(false)
  const completedRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Where the student had got to last time, once the video has jumped there —
  // shown as a small note with a way back to the start.
  const [resumedAt, setResumedAt] = useState<number | null>(null)
  // Seconds left before moving on to the next lesson after a video ends.
  const [upNextIn, setUpNextIn] = useState<number | null>(null)
  const router = useRouter()

  const { data, loading, error, refetch } = useFetch<LessonData>(`/api/student/lessons/${id}`, {
    // A locked lesson is a page of its own below, not a failure to report.
    errorMessage: false,
    onError: (e) => {
      if (!(e.details as Partial<LockedLesson> | null)?.locked) toast.error("Could not load lesson")
    },
    onSuccess: (d) => {
      setIsCompleted(d.lesson.isCompleted)
      completedRef.current = d.lesson.isCompleted
    },
  })

  const { execute: saveProgress, loading: saving } = usePatchCallback<
    { progress: object },
    { enrollmentId: string; isCompleted?: boolean; watchedSecs?: number }
  >(`/api/student/lessons/${id}/progress`, {
    successMessage: (d) => {
      const p = (d as { progress: { isCompleted: boolean } }).progress
      return p.isCompleted ? "Lesson marked as complete!" : "Progress saved"
    },
    errorMessage: "Could not save progress",
    onSuccess: () => {
      refetch()
    },
  })

  async function handleMarkComplete() {
    if (!data?.enrollmentId) return
    const newState = !isCompleted
    setIsCompleted(newState)
    completedRef.current = newState
    await saveProgress({ enrollmentId: data.enrollmentId, isCompleted: newState })
  }

  // Debounced video progress auto-save (every 10 s of playback)
  const enrollmentId = data?.enrollmentId
  const handleTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (!enrollmentId) return
      const video = e.currentTarget
      if (saveTimerRef.current) return // already scheduled
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        // Silent: no toast and no reload while the student is watching. A
        // missed save is caught up by the next one 10 s later.
        fetch(`/api/student/lessons/${id}/progress`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enrollmentId, watchedSecs: Math.floor(video.currentTime) }),
          keepalive: true,
        }).catch(() => {})
      }, 10_000)
    },
    [enrollmentId, id]
  )

  // Pick the video up where the student stopped — unless they had all but
  // finished it, or had barely started, when the start is the better place.
  const resumeFrom = data?.lesson.watchedSecs ?? 0
  const handleLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = e.currentTarget
      if (resumeFrom > 5 && video.duration && resumeFrom < video.duration - 15) {
        video.currentTime = resumeFrom
        setResumedAt(resumeFrom)
      }
    },
    [resumeFrom]
  )

  // A video lesson ticks itself off once 90% of it has been watched.
  const handleVideoProgress = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      handleTimeUpdate(e)
      const video = e.currentTarget
      // The "picked up at" note has done its job once the video is under way.
      if (resumedAt !== null && video.currentTime > resumedAt + 8) setResumedAt(null)
      if (completedRef.current || !enrollmentId || !video.duration) return
      if (video.currentTime / video.duration < 0.9) return
      completedRef.current = true
      setIsCompleted(true)
      fetch(`/api/student/lessons/${id}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, isCompleted: true, watchedSecs: Math.floor(video.currentTime) }),
      })
        .then((res) => {
          if (!res.ok) throw new Error()
          toast.success("Lesson complete")
          refetch()
        })
        .catch(() => {
          // Leave it for the button (or the next play) to try again.
          completedRef.current = false
          setIsCompleted(false)
        })
    },
    [handleTimeUpdate, resumedAt, enrollmentId, id, refetch]
  )

  // When the video ends, count down to the next lesson; the student can stay.
  const nextLesson = data?.navigation.next && !data.navigation.next.locked ? data.navigation.next : null
  useEffect(() => {
    if (upNextIn === null || !nextLesson) return
    if (upNextIn <= 0) {
      router.push(`/student/lessons/${nextLesson.id}`)
      return
    }
    const t = setTimeout(() => setUpNextIn(upNextIn - 1), 1000)
    return () => clearTimeout(t)
  }, [upNextIn, nextLesson, router])

  // Clear a pending auto-save when leaving the lesson.
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  // Only the first load replaces the page; a refetch keeps the lesson (and its video) on screen.
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  const locked = (error?.details as Partial<LockedLesson> | null)?.locked
    ? (error!.details as LockedLesson)
    : null
  if (locked) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6">
        <div className="rounded-full bg-amber-100 p-6">
          <Lock className="size-10 text-amber-700" />
        </div>
        <div>
          <h2 className="text-xl font-bold">This lesson is locked</h2>
          <p className="text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
            <CalendarClock className="size-4" /> It unlocks {releaseLabel(locked.releaseAt)}.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/student/lessons?courseId=${locked.courseId}`}>
            <ChevronLeft className="size-4 mr-1" /> Back to the course
          </Link>
        </Button>
      </div>
    )
  }

  if (!data) return null

  const { lesson, course, section, navigation, progress, sections } = data
  const videoAsset = lesson.assets.find((a) => a.type === "VIDEO")
  const otherAssets = lesson.assets.filter((a) => a.type !== "VIDEO" && a.type !== "SUBTITLE")
  const LessonIcon = typeIcon[lesson.type]

  return (
    <div className="flex gap-0 -mx-6 -mt-8 min-h-[calc(100vh-4rem)]">

      {/* ── Left sidebar — syllabus ───────────────────────────────────────── */}
      <aside
        className={cn(
          "shrink-0 border-r bg-background flex flex-col transition-all duration-200 overflow-hidden",
          sidebarOpen ? "w-72" : "w-0"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <span className="text-sm font-bold">Course Content</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Overall progress */}
        <div className="px-4 py-3 border-b shrink-0">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">{progress.completedLessons}/{progress.totalLessons} completed</span>
            <span className="font-semibold">{progress.completion}%</span>
          </div>
          <Progress value={progress.completion} className="h-1.5" />
        </div>

        {/* Sections + lessons */}
        <div className="overflow-y-auto flex-1">
          {sections.map((sec) => (
            <div key={sec.id}>
              <div className="px-4 py-2 bg-muted/30 border-b">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {sec.order}. {sec.title}
                </p>
              </div>
              {sec.lessons.map((l) => {
                const Icon = typeIcon[l.type as keyof typeof typeIcon] ?? PlayCircle
                if (l.locked) {
                  return (
                    <div
                      key={l.id}
                      aria-disabled="true"
                      title={l.releaseAt ? `Unlocks ${releaseLabel(l.releaseAt)}` : "Not released yet"}
                      className="flex items-center gap-3 px-4 py-2.5 border-b text-sm text-muted-foreground bg-muted/10"
                    >
                      <div className="shrink-0 size-4 rounded-full border-2 border-dashed border-muted-foreground/30" />
                      <Lock className="size-3.5 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block leading-snug truncate">{l.order}. {l.title}</span>
                        {l.releaseAt && (
                          <span className="block text-[10px] leading-tight">Unlocks {releaseLabel(l.releaseAt)}</span>
                        )}
                      </span>
                    </div>
                  )
                }
                return (
                  <Link
                    key={l.id}
                    href={`/student/lessons/${l.id}`}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 border-b text-sm transition-colors",
                      l.isCurrent
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-muted/30"
                    )}
                  >
                    <div className="shrink-0">
                      {l.isCompleted ? (
                        <CheckCircle2 className="size-4 text-emerald-500" />
                      ) : (
                        <div className={cn(
                          "size-4 rounded-full border-2",
                          l.isCurrent ? "border-primary" : "border-muted-foreground/30"
                        )} />
                      )}
                    </div>
                    <Icon className={cn("size-3.5 shrink-0", l.isCurrent ? "text-primary" : "text-muted-foreground")} />
                    <span className={cn("flex-1 leading-snug", l.isCurrent && "font-semibold text-primary")}>
                      {l.order}. {l.title}
                    </span>
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Breadcrumb + toggle */}
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-background shrink-0">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground hover:text-foreground">
              <List className="size-5" />
            </button>
          )}
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground flex-1 min-w-0">
            <Link href="/student/lessons" className="hover:text-foreground shrink-0 max-sm:py-2">Lessons</Link>
            <ChevronRight className="size-3 shrink-0" />
            <span className="truncate">{course.title}</span>
            <ChevronRight className="size-3 shrink-0" />
            <span className="text-foreground font-medium truncate">{lesson.title}</span>
          </nav>
          <span className="text-xs text-muted-foreground shrink-0">
            {navigation.currentIndex} / {navigation.total}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {lesson.videoPending && (
            <p className="mx-6 mt-6 rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              The video for this lesson is still being prepared. Please check back in a few minutes.
            </p>
          )}
          {/* Video player */}
          {lesson.type === "VIDEO" && videoAsset ? (
            <div className="bg-black aspect-video w-full relative">
              <ProtectedVideo
                key={videoAsset.id}
                src={videoAsset.fileUrl}
                controls
                className="w-full h-full"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleVideoProgress}
                onPlay={() => setUpNextIn(null)}
                onEnded={() => { if (nextLesson) setUpNextIn(5) }}
              />
              {resumedAt !== null && upNextIn === null && (
                <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 text-white text-xs pl-3 pr-1 py-1">
                  Picked up at {formatDuration(resumedAt)}
                  <button
                    type="button"
                    className="rounded-full bg-white/15 hover:bg-white/25 px-2 py-0.5 font-semibold"
                    onClick={(e) => {
                      const video = e.currentTarget.closest("div.relative")?.querySelector("video")
                      if (video) video.currentTime = 0
                      setResumedAt(null)
                    }}
                  >
                    Start over
                  </button>
                </div>
              )}
              {upNextIn !== null && nextLesson && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 p-4">
                  <div className="text-center text-white max-w-sm">
                    <p className="text-xs uppercase tracking-wide opacity-70">Up next in {upNextIn}</p>
                    <p className="mt-1 text-lg font-bold leading-snug line-clamp-2">{nextLesson.title}</p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setUpNextIn(null)}>
                        Stay here
                      </Button>
                      <Button asChild size="sm">
                        <Link href={`/student/lessons/${nextLesson.id}`}>
                          Play now <ChevronRight className="size-4 ml-1" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : lesson.type === "TEXT" || (lesson.type === "VIDEO" && lesson.assets.length > 0) ? (
            // Text lessons, and video lessons that hold files but no video, show the files inline.
            <div className="flex flex-col gap-6 px-6 py-6">
              {lesson.assets.map((asset) => {
                if (asset.type === "VIDEO") {
                  return (
                    <div key={asset.id} className="rounded-xl overflow-hidden border bg-black">
                      <ProtectedVideo
                        src={asset.fileUrl}
                        controls
                        autoPlay
                        className="w-full aspect-video"
                        onTimeUpdate={handleTimeUpdate}
                      />
                    </div>
                  )
                }

                if (asset.type === "IMAGE") {
                  return (
                    <div key={asset.id} className="rounded-xl overflow-hidden border">
                      <img
                        src={asset.fileUrl}
                        alt={asset.title}
                        className="w-full object-contain max-h-125"
                      />
                    </div>
                  )
                }

                if (asset.type === "AUDIO") {
                  return (
                    <div key={asset.id} className="rounded-xl border bg-muted/20 p-4 flex flex-col gap-2">
                      <p className="text-sm font-semibold">{asset.title}</p>
                      <audio src={asset.fileUrl} controls className="w-full" />
                    </div>
                  )
                }

                if (asset.type === "PDF") {
                  return (
                    <div key={asset.id} className="flex flex-col gap-2">
                      <p className="text-sm font-semibold">{asset.title}</p>
                      {/* Phone browsers don't render a PDF inside an iframe (Android
                          shows a blank box, iOS only the first page), so on small
                          screens the file opens in the browser's own viewer instead. */}
                      <div className="hidden md:block rounded-xl border overflow-hidden" style={{ height: "700px" }}>
                        <iframe
                          src={asset.fileUrl}
                          className="w-full h-full"
                          title={asset.title}
                        />
                      </div>
                      <a
                        href={asset.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={asset.fileName}
                        className="md:hidden flex items-center gap-3 rounded-xl border p-4 hover:border-primary hover:bg-primary/5 transition-colors"
                      >
                        <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
                          <FileText className="size-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{asset.fileName || asset.title}</p>
                          <p className="text-xs text-muted-foreground">Tap to open or download</p>
                        </div>
                        <Download className="size-4 text-primary shrink-0" />
                      </a>
                      <a
                        href={asset.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={asset.fileName}
                        className="hidden md:inline-flex self-start items-center gap-1.5 text-xs text-primary underline underline-offset-2"
                      >
                        <Download className="size-3.5" />
                        Open / download PDF
                      </a>
                    </div>
                  )
                }

                if (asset.type === "DOCUMENT") {
                  // Use Microsoft Office Online viewer for Word/Excel/PowerPoint files
                  const officeViewer = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(asset.fileUrl)}`
                  return (
                    <div key={asset.id} className="flex flex-col gap-2">
                      <p className="text-sm font-semibold">{asset.title}</p>
                      <div className="rounded-xl border overflow-hidden" style={{ height: "700px" }}>
                        <iframe
                          src={officeViewer}
                          className="w-full h-full"
                          title={asset.title}
                        />
                      </div>
                      <a
                        href={asset.fileUrl}
                        download={asset.fileName}
                        className="self-start text-xs text-primary underline underline-offset-2"
                      >
                        Download file
                      </a>
                    </div>
                  )
                }

                // Fallback: download link for any other type (SUBTITLE, etc.)
                return (
                  <div key={asset.id} className="rounded-xl border bg-muted/20 p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{asset.title || asset.fileName}</p>
                      <p className="text-xs text-muted-foreground">{asset.type.toLowerCase()}</p>
                    </div>
                    <a
                      href={asset.fileUrl}
                      download={asset.fileName}
                      className="text-xs text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors shrink-0"
                    >
                      Download
                    </a>
                  </div>
                )
              })}
            </div>
          ) : lesson.type === "QUIZ" ? (
            <div className="mx-6 mt-6 rounded-xl border bg-background p-6">
              {/* Keyed by lesson so moving to the next test starts it afresh. */}
              <QuizTaker
                key={id}
                lessonId={id}
                enrollmentId={data.enrollmentId}
                onCompleted={() => { setIsCompleted(true); completedRef.current = true }}
                nextHref={navigation.next ? `/student/lessons/${navigation.next.id}` : undefined}
              />
            </div>
          ) : (
            <div className="mx-6 mt-6 rounded-xl border bg-primary/5 p-6 text-center">
              <FlaskConical className="size-10 text-primary mx-auto mb-2" />
              <p className="font-semibold">Content coming soon</p>
            </div>
          )}

          {/* Lesson title + mark complete */}
          <div className="px-6 py-5 flex items-start justify-between gap-4 border-b">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <LessonIcon className="size-4 text-primary shrink-0" />
                <Badge variant="outline" className="text-[10px]">{section.title}</Badge>
              </div>
              <h1 className="text-xl font-black tracking-tight">{lesson.title}</h1>
            </div>
            {lesson.type === "QUIZ" ? (
              // A test is completed by passing it, not by ticking it off.
              isCompleted && (
                <Badge variant="outline" className="shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200">
                  <CheckCheck className="size-3.5 mr-1" /> Passed
                </Badge>
              )
            ) : (
              <Button
                size="sm"
                variant={isCompleted ? "outline" : "default"}
                onClick={handleMarkComplete}
                disabled={saving || !data.enrollmentId}
                className="shrink-0"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isCompleted ? (
                  <><CheckCheck className="size-4 mr-1.5" /> Completed</>
                ) : (
                  <><CheckCircle2 className="size-4 mr-1.5" /> Mark Complete</>
                )}
              </Button>
            )}
          </div>

          {/* Tabs */}
          <div className="px-6 py-6">
            <Tabs defaultValue="overview">
              <TabsList className="mb-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="resources">Resources</TabsTrigger>
                <TabsTrigger value="instructor">Instructor</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                {lesson.description ? (
                  <SafeHtml className="prose prose-sm max-w-none text-foreground" html={lesson.description} />
                ) : (
                  <p className="text-sm text-muted-foreground italic">No description provided.</p>
                )}
              </TabsContent>

              <TabsContent value="resources">
                {otherAssets.length > 0 ? (
                  <div className="grid gap-3">
                    {otherAssets.map((asset) => (
                      <a
                        key={asset.id}
                        href={asset.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-xl border p-4 hover:border-primary hover:bg-primary/5 transition-colors group"
                      >
                        <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
                          <FileText className="size-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-snug">{asset.title}</p>
                          {asset.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{asset.description}</p>
                          )}
                          {asset.fileSize && (
                            <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(asset.fileSize)}</p>
                          )}
                        </div>
                        <Download className="size-4 text-muted-foreground group-hover:text-primary shrink-0" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No resources for this lesson.</p>
                )}
              </TabsContent>

              <TabsContent value="instructor">
                <Card className="shadow-none border">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-4">
                      <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        {course.tutor.avatarUrl ? (
                          <img src={course.tutor.avatarUrl} alt={course.tutor.name} className="size-14 rounded-full object-cover" />
                        ) : (
                          <User className="size-7 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold">{course.tutor.name}</p>
                        <p className="text-xs text-muted-foreground">BSL Instructor</p>
                      </div>
                    </div>
                    {course.tutor.tutorProfile?.bio && (
                      <>
                        <Separator className="my-4" />
                        <p className="text-sm text-muted-foreground">{course.tutor.tutorProfile.bio}</p>
                      </>
                    )}
                    {course.tutor.tutorProfile?.qualifications?.length ? (
                      <>
                        <Separator className="my-4" />
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Qualifications</p>
                        <div className="flex flex-wrap gap-2">
                          {course.tutor.tutorProfile.qualifications.map((q) => (
                            <Badge key={q} variant="outline" className="text-xs">{q}</Badge>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* ── Bottom nav ───────────────────────────────────────────────────── */}
        <div className="border-t bg-background px-6 py-3 flex items-center justify-between shrink-0">
          {navigation.prev && !navigation.prev.locked ? (
            <Button asChild variant="outline" size="sm" className="h-auto py-1.5">
              <Link href={`/student/lessons/${navigation.prev.id}`}>
                <ChevronLeft className="size-4 mr-1 shrink-0" />
                <div className="text-left min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">Previous</p>
                  <p className="text-xs font-medium truncate max-w-28 sm:max-w-56 leading-tight mt-0.5">{navigation.prev.title}</p>
                </div>
              </Link>
            </Button>
          ) : (
            <div />
          )}

          {navigation.next?.locked ? (
            // The next lesson exists but has not been released: say when.
            <Button size="sm" variant="outline" disabled className="disabled:opacity-100 text-muted-foreground">
              <Lock className="size-3.5 mr-1.5" />
              Next unlocks {navigation.next.releaseAt ? releaseLabel(navigation.next.releaseAt) : "later"}
            </Button>
          ) : navigation.next ? (
            <Button asChild size="sm" className="h-auto py-1.5">
              <Link href={`/student/lessons/${navigation.next.id}`}>
                <div className="text-right min-w-0">
                  <p className="text-[10px] uppercase tracking-wide opacity-70 leading-none">Next</p>
                  <p className="text-xs font-semibold truncate max-w-28 sm:max-w-56 leading-tight mt-0.5">{navigation.next.title}</p>
                </div>
                <ChevronRight className="size-4 ml-1 shrink-0" />
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href="/student/lessons">
                <CheckCheck className="size-4 mr-1.5" />
                Back to Lessons
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
