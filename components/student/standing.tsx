"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Frown, Loader2, Meh, Smile, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { CourseStanding, Mood } from "@/lib/student-standing"

/**
 * The student's side of lib/student-standing.ts: a face for each area of each
 * running course on the dashboard, and the "you're falling behind" notice that
 * has to be acknowledged before they carry on.
 */

// One request shared by the notice (every page) and the dashboard card.
let cache: { at: number; promise: Promise<CourseStanding[]> } | null = null

function loadStanding(): Promise<CourseStanding[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.promise
  const promise = fetch("/api/student/standing")
    .then((r) => (r.ok ? r.json() : { courses: [] }))
    .then((d: { courses?: CourseStanding[] }) => d.courses ?? [])
    .catch(() => [])
  cache = { at: Date.now(), promise }
  return promise
}

/** Forget the shared answer, so the next page asks again. */
function clearStanding() {
  cache = null
}

function useStanding(): CourseStanding[] | null {
  const [courses, setCourses] = useState<CourseStanding[] | null>(null)
  useEffect(() => {
    let live = true
    loadStanding().then((c) => { if (live) setCourses(c) })
    return () => { live = false }
  }, [])
  return courses
}

const MOODS: Record<Mood, { Icon: typeof Smile; label: string; circle: string; icon: string }> = {
  happy: {
    Icon: Smile, label: "Doing well",
    circle: "bg-emerald-100 dark:bg-emerald-900/40", icon: "text-emerald-600 dark:text-emerald-400",
  },
  okay: {
    Icon: Meh, label: "Keep going",
    circle: "bg-amber-100 dark:bg-amber-900/40", icon: "text-amber-600 dark:text-amber-400",
  },
  sad: {
    Icon: Frown, label: "Lots to catch up",
    circle: "bg-rose-100 dark:bg-rose-900/40", icon: "text-rose-600 dark:text-rose-400",
  },
}

export function MoodFace({ mood, size = "md" }: { mood: Mood; size?: "md" | "lg" }) {
  const { Icon, label, circle, icon } = MOODS[mood]
  return (
    <span className={`inline-flex items-center justify-center rounded-full shrink-0 ${circle} ${size === "lg" ? "p-4" : "p-2"}`} title={label}>
      <Icon className={`${icon} ${size === "lg" ? "size-10" : "size-6"}`} aria-label={label} />
    </span>
  )
}

/** Dashboard card: one face per area of each running course. */
export function StandingCard() {
  const courses = useStanding()
  if (!courses || courses.length === 0) return null

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" />
          How you&apos;re doing
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex flex-col gap-4">
        {courses.map((c) => (
          <div key={c.courseId} className="flex flex-col gap-2">
            {courses.length > 1 && <p className="text-sm font-semibold truncate">{c.title}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {c.areas.map((a) => (
                <Link
                  key={a.key}
                  href={a.key === "tests" ? "/student/tests" : `/student/lessons?courseId=${c.courseId}`}
                  className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <MoodFace mood={a.mood} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{a.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {MOODS[a.mood].label} · {a.done} of {a.total} done
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function reason(c: CourseStanding): string {
  if (c.behindClass) {
    return `You've done ${c.percent}% of the work on ${c.title} so far — the rest of your class is at ${c.classAverage}%.`
  }
  return `You haven't done any work on ${c.title} for over a week, and there's work waiting for you.`
}

/**
 * Stops the student until they press "I understand" when they've fallen
 * behind, so the message can't be scrolled past. Never shown in a live class.
 */
export function BehindNotice() {
  const courses = useStanding()
  const pathname = usePathname()
  const router = useRouter()
  const [closed, setClosed] = useState(false)
  const [saving, setSaving] = useState(false)

  const due = courses?.filter((c) => c.noticeDue) ?? []
  const inClass = /^\/student\/classroom\/[^/]+/.test(pathname ?? "")
  if (closed || due.length === 0 || inClass) return null

  async function acknowledge() {
    setSaving(true)
    try {
      await fetch("/api/student/standing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: due.map((c) => c.courseId) }),
      })
    } catch { /* still let them carry on */ }
    clearStanding()
    setClosed(true)
    setSaving(false)
    router.push(`/student/lessons?courseId=${due[0].courseId}`)
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="max-w-md max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center text-center gap-3">
          <MoodFace mood="sad" size="lg" />
          <DialogTitle className="text-xl">You&apos;re falling behind</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-2 text-sm">
              {due.map((c) => <p key={c.courseId}>{reason(c)}</p>)}
            </div>
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-2">
          {due.flatMap((c) => c.areas.map((a) => (
            <div key={`${c.courseId}-${a.key}`} className="flex items-center gap-3 rounded-xl border p-2.5">
              <MoodFace mood={a.mood} />
              <div className="min-w-0 text-left">
                <p className="text-sm font-bold">
                  {a.label}{due.length > 1 && <span className="font-normal text-muted-foreground"> · {c.title}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.done} of {a.total} done{a.total - a.done > 0 ? ` — ${a.total - a.done} still to do` : ""}
                </p>
              </div>
            </div>
          )))}
        </div>

        <p className="text-sm text-muted-foreground text-center">
          A little each day makes your next class much easier. Your teacher can see how you&apos;re getting on.
        </p>

        <Button className="w-full" size="lg" disabled={saving} onClick={acknowledge}>
          {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
          I understand — take me to my work
        </Button>
      </DialogContent>
    </Dialog>
  )
}
