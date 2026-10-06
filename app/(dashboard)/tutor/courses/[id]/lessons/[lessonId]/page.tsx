"use client"

import { use } from "react"
import Link from "next/link"
import {
  ChevronLeft, CheckCircle2, Circle, Download, Edit3, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { useCoursesBase } from "@/hooks/use-courses-base"
import { mediaDownloadHref } from "@/lib/protected-media"
import { lessonKind } from "@/lib/lesson-kind"
import { cn } from "@/lib/utils"
import { ReleaseBadge } from "@/components/courses/ReleaseField"
import { QuizResults } from "@/components/quiz/QuizResults"
import { isVideoMedia } from "@/lib/quiz"

// ─── Types ────────────────────────────────────────────────────────────────────

type Asset = {
  id: string
  type: string
  title: string
  fileUrl: string
  fileName: string
}

type Option = {
  id: string
  text: string
  imageUrl: string | null
  mediaType: string | null
  isCorrect: boolean
}

type LessonFull = {
  id: string
  title: string
  type: "VIDEO" | "TEXT" | "QUIZ"
  description: string | null
  isFree: boolean
  releaseAt: string | null
  passMark: number
  maxAttempts: number | null
  assets: Asset[]
  questions: Array<{
    id: string
    question: string
    imageUrl: string | null
    mediaType: string | null
    options: Option[]
  }>
  section: { title: string; course: { title: string } }
}

type LessonData = { lesson: LessonFull; canEdit: boolean }

// ─── Page ────────────────────────────────────────────────────────────────────

// A lesson as the teacher follows it: the material and, for a test, how the
// students did and the answers. The content cannot be changed here — admins
// edit lessons from the builder.
export default function ViewLessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>
}) {
  const { id: courseId, lessonId } = use(params)
  const coursesBase = useCoursesBase()
  const { data, loading } = useFetch<LessonData>(`/api/tutor/lessons/${lessonId}`, {
    errorMessage: "Could not load lesson",
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-75">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) {
    return <div className="text-center py-16 text-muted-foreground">Lesson not found.</div>
  }

  const { lesson, canEdit } = data
  const { label, Icon } = lessonKind(lesson.type, lesson.assets)

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="self-start -ml-2">
        <Link href={`${coursesBase}/${courseId}`}>
          <ChevronLeft className="size-4 mr-1" /> Back to Course
        </Link>
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            {lesson.section.course.title} · {lesson.section.title}
          </p>
          <h1 className="text-2xl font-black tracking-tight break-words mt-0.5">{lesson.title}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="gap-1">
              <Icon className="size-3" /> {label}
            </Badge>
            {lesson.isFree && <Badge variant="outline">Free preview</Badge>}
            <ReleaseBadge releaseAt={lesson.releaseAt} />
            {lesson.type === "QUIZ" && (
              <>
                <Badge variant="outline">Pass mark {lesson.passMark}%</Badge>
                <Badge variant="outline">
                  {lesson.maxAttempts === null
                    ? "Unlimited attempts"
                    : `${lesson.maxAttempts} attempt${lesson.maxAttempts !== 1 ? "s" : ""}`}
                </Badge>
              </>
            )}
          </div>
        </div>
        {canEdit && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={`${coursesBase}/${courseId}/lessons/${lessonId}/edit`}>
              <Edit3 className="size-4 mr-1.5" /> {lesson.type === "QUIZ" ? "Edit Test" : "Edit Lesson"}
            </Link>
          </Button>
        )}
      </div>

      {lesson.description && (
        <div className="rounded-xl border bg-muted/20 p-6">
          <div
            className="prose prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: lesson.description }}
          />
        </div>
      )}

      {/* Lesson material */}
      {lesson.type !== "QUIZ" && (
        lesson.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files have been added to this lesson yet.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {lesson.assets.map((asset) => (
              <AssetView key={asset.id} asset={asset} />
            ))}
          </div>
        )
      )}

      {/* Test — how the students did, and the questions with the correct answers marked */}
      {lesson.type === "QUIZ" && (
        <Tabs defaultValue="results">
          <TabsList className="mb-4">
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="questions">Questions ({lesson.questions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="results">
            <QuizResults lessonId={lesson.id} questions={lesson.questions} />
          </TabsContent>

          <TabsContent value="questions">
          {lesson.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions have been added to this test yet.</p>
          ) : (
            <div className="flex flex-col gap-6">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {lesson.questions.length} question{lesson.questions.length !== 1 ? "s" : ""} · correct answers shown
              </p>
              {lesson.questions.map((q, i) => (
                <div key={q.id} className="flex flex-col gap-2">
                  <p className="text-sm font-medium">{i + 1}. {q.question}</p>
                  {q.imageUrl && (
                    isVideoMedia(q.imageUrl, q.mediaType)
                      ? <ProtectedVideo src={q.imageUrl} muted loop playsInline controls className="rounded-lg max-h-48 border bg-black self-start" />
                      : <img src={q.imageUrl} alt="question" className="rounded-lg max-h-48 object-contain border self-start" />
                  )}
                  <div className={cn(
                    "pl-6",
                    q.options.some((o) => o.imageUrl) ? "grid grid-cols-2 gap-2" : "flex flex-col gap-1.5"
                  )}>
                    {q.options.map((opt) => (
                      <div
                        key={opt.id}
                        className={cn(
                          "rounded-lg border text-sm overflow-hidden",
                          opt.imageUrl ? "flex flex-col p-0" : "flex items-center gap-2 px-3 py-2",
                          opt.isCorrect && "border-emerald-300 bg-emerald-50 text-emerald-800",
                        )}
                      >
                        {opt.imageUrl && (
                          isVideoMedia(opt.imageUrl, opt.mediaType)
                            ? <ProtectedVideo src={opt.imageUrl} muted loop playsInline controls className="w-full aspect-video object-cover" />
                            : <img src={opt.imageUrl} alt={opt.text} className="w-full aspect-square object-cover" />
                        )}
                        <div className={cn("flex items-center gap-2 w-full", opt.imageUrl ? "px-2 py-1.5" : "")}>
                          {opt.isCorrect
                            ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                            : <Circle className="size-3.5 shrink-0 text-muted-foreground" />}
                          {opt.text && <span className="text-xs">{opt.text}</span>}
                          {opt.isCorrect && (
                            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Correct</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ─── One lesson file, shown the way students see it ──────────────────────────

function AssetView({ asset }: { asset: Asset }) {
  const download = (
    <a
      href={mediaDownloadHref(asset.fileUrl)}
      download={asset.fileName}
      className="self-start inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
    >
      <Download className="size-3" /> Download {asset.fileName}
    </a>
  )

  if (asset.type === "VIDEO") {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-xl overflow-hidden border bg-black">
          <ProtectedVideo src={asset.fileUrl} controls allowDownload className="w-full aspect-video" />
        </div>
        {download}
      </div>
    )
  }

  if (asset.type === "IMAGE") {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-xl overflow-hidden border">
          <img src={asset.fileUrl} alt={asset.title} className="w-full object-contain max-h-125" />
        </div>
        {download}
      </div>
    )
  }

  if (asset.type === "AUDIO") {
    return (
      <div className="rounded-xl border bg-muted/20 p-4 flex flex-col gap-2">
        <p className="text-sm font-semibold">{asset.title}</p>
        <audio src={asset.fileUrl} controls className="w-full" />
        {download}
      </div>
    )
  }

  if (asset.type === "PDF" || asset.type === "DOCUMENT") {
    // Office files go through Microsoft's online viewer; PDFs open natively.
    const src = asset.type === "PDF"
      ? asset.fileUrl
      : `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(asset.fileUrl)}`
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{asset.title}</p>
        <div className="rounded-xl border overflow-hidden" style={{ height: "700px" }}>
          <iframe src={src} className="w-full h-full" title={asset.title} />
        </div>
        {download}
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-muted/20 p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{asset.title || asset.fileName}</p>
        <p className="text-xs text-muted-foreground">{asset.type.toLowerCase()}</p>
      </div>
      {download}
    </div>
  )
}
