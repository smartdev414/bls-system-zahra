"use client"

import { PdfPages, useDeviceKind } from "@/components/ui/pdf-pages"
import { SafeHtml } from "@/components/ui/safe-html"
import { use } from "react"
import Link from "next/link"
import {
  ChevronLeft, Download, Edit3, FlaskConical, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { useCoursesBase } from "@/hooks/use-courses-base"
import { useTestsBase } from "@/hooks/use-tests-base"
import { mediaDownloadHref } from "@/lib/protected-media"
import { lessonKind } from "@/lib/lesson-kind"
import { ReleaseBadge } from "@/components/courses/ReleaseField"
import { QuizResults } from "@/components/quiz/QuizResults"
import { TestQuestionsView, type ViewQuestion } from "@/components/tests/TestQuestionsView"
import { TEST_KIND_INFO, type TestKind } from "@/lib/quiz"
import { VideoCleanBadge } from "@/components/ui/video-clean-badge"

// ─── Types ────────────────────────────────────────────────────────────────────

type Asset = {
  id: string
  type: string
  title: string
  fileUrl: string
  fileName: string
}

type LessonFull = {
  id: string
  title: string
  type: "VIDEO" | "TEXT" | "QUIZ"
  description: string | null
  isFree: boolean
  releaseAt: string | null
  assets: Asset[]
  /** Tests: the bank test this lesson shows. */
  test: {
    id: string
    testKind: TestKind
    passMark: number
    maxAttempts: number | null
    /** Story tests: the video the questions are about. */
    storyUrl: string | null
    questions: ViewQuestion[]
  } | null
  section: { title: string; course: { title: string } }
}

type LessonData = { lesson: LessonFull; canEdit: boolean }

// ─── Page ────────────────────────────────────────────────────────────────────

// A lesson as the teacher follows it: the material and, for a test, how the
// students did and the answers. The content cannot be changed here — admins
// edit lessons from the builder, and a test is changed in the Tests menu.
export default function ViewLessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>
}) {
  const { id: courseId, lessonId } = use(params)
  const coursesBase = useCoursesBase()
  const testsBase = useTestsBase()
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
  const test = lesson.type === "QUIZ" ? lesson.test : null

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
            {test && (
              <>
                <Badge variant="outline">{TEST_KIND_INFO[test.testKind].label}</Badge>
                <Badge variant="outline">Pass mark {test.passMark}%</Badge>
                <Badge variant="outline">
                  {test.maxAttempts === null
                    ? "Unlimited attempts"
                    : `${test.maxAttempts} attempt${test.maxAttempts !== 1 ? "s" : ""}`}
                </Badge>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 shrink-0">
          {test && (
            <Button asChild variant="outline" size="sm">
              <Link href={`${testsBase}/${test.id}`}>
                <FlaskConical className="size-4 mr-1.5" /> Open in Tests
              </Link>
            </Button>
          )}
          {canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`${coursesBase}/${courseId}/lessons/${lessonId}/edit`}>
                <Edit3 className="size-4 mr-1.5" /> {test ? "Release date" : "Edit Lesson"}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {lesson.description && (
        <div className="rounded-xl border bg-muted/20 p-6">
          <SafeHtml className="prose prose-sm max-w-none text-foreground" html={lesson.description} />
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
      {test && (
        <Tabs defaultValue="results">
          <TabsList className="mb-4">
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="questions">Questions ({test.questions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="results">
            <QuizResults lessonId={lesson.id} questions={test.questions} />
          </TabsContent>

          <TabsContent value="questions">
            <TestQuestionsView kind={test.testKind} storyUrl={test.storyUrl} questions={test.questions} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ─── One lesson file, shown the way students see it ──────────────────────────

function AssetView({ asset }: { asset: Asset }) {
  // A tablet shows an embedded PDF's first page only, so it gets every page drawn instead.
  const device = useDeviceKind()
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
        <VideoCleanBadge url={asset.fileUrl} />
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
        {asset.type === "PDF" && device !== null && device !== "desktop" ? (
          <PdfPages url={asset.fileUrl} title={asset.title} />
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ height: "700px" }}>
            <iframe src={src} className="w-full h-full" title={asset.title} />
          </div>
        )}
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
