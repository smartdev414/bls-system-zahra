"use client"

import Link from "next/link"
import { Clapperboard, Download, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { useFetch } from "@/hooks/use-fetch"
import { mediaDownloadHref } from "@/lib/protected-media"

type Recording = {
  id: string
  videoUrl: string
  question: string
  /** The student's own tick or cross; null while still to be marked. */
  correct: boolean | null
  recordedAt: string
  test: { lessonId: string; title: string }
  course: { id: string; title: string }
  /** Set once the course has ended for the student: when these go. */
  deleteAt: string | null
}

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

/**
 * The student's own signing videos from tests, by course, each with a
 * Download button. They are kept while the course runs; once it has ended the
 * day they will be deleted is shown at the top of that course.
 */
export default function MyVideosPage() {
  const { data, loading } = useFetch<{ recordings: Recording[] }>("/api/student/recordings", {
    errorMessage: "Could not load your videos",
  })

  const courses = new Map<string, { title: string; deleteAt: string | null; items: Recording[] }>()
  for (const r of data?.recordings ?? []) {
    const course = courses.get(r.course.id) ?? { title: r.course.title, deleteAt: r.deleteAt, items: [] }
    course.items.push(r)
    courses.set(r.course.id, course)
  }
  // Courses whose videos are about to go come first.
  const ordered = [...courses.entries()].sort(([, a], [, b]) =>
    (a.deleteAt ? 0 : 1) - (b.deleteAt ? 0 : 1) || (a.deleteAt ?? "").localeCompare(b.deleteAt ?? ""))

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Clapperboard className="size-6 text-primary" />
          My videos
        </h1>
        <p className="text-muted-foreground mt-1">
          The videos you filmed of yourself signing in tests. They are kept until your course ends — download any you want to keep.
        </p>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center min-h-[200px]"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center">
          You haven&apos;t filmed any signing in tests yet.
        </p>
      ) : (
        ordered.map(([courseId, course]) => (
          <section key={courseId} className="flex flex-col gap-3">
            <h2 className="font-bold">{course.title}</h2>
            {course.deleteAt && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                This course has finished. These videos will be deleted on {longDate(course.deleteAt)} — download any you want to keep.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {course.items.map((r) => (
                <div key={r.id} className="rounded-xl border overflow-hidden flex flex-col">
                  <ProtectedVideo src={r.videoUrl} controls playsInline preload="metadata" className="w-full aspect-video bg-black" />
                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <p className="text-sm font-medium leading-snug">{r.question}</p>
                    <p className="text-xs text-muted-foreground">
                      <Link href={`/student/lessons/${r.test.lessonId}`} className="hover:underline">{r.test.title}</Link>
                      {" · "}{shortDate(r.recordedAt)}
                    </p>
                    {r.correct !== null && (
                      <Badge variant="outline" className={r.correct ? "self-start text-[0.625rem] bg-emerald-50 text-emerald-700 border-emerald-200" : "self-start text-[0.625rem] bg-rose-50 text-rose-700 border-rose-200"}>
                        {r.correct ? "✓ Correct" : "✗ Not right"}
                      </Badge>
                    )}
                    <Button asChild variant="outline" size="sm" className="mt-auto self-start">
                      <a href={mediaDownloadHref(r.videoUrl)} download>
                        <Download className="size-4 mr-1.5" /> Download
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
